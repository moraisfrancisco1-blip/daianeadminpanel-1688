import { Hono } from "hono";
import { db } from "../database";
import { invoices, invoiceItems, clients, payments } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { computeTotals, vatBreakdownFromNet } from "../lib/totals";
import { nextNumber } from "../lib/counters";
import { generateInvoicePdf } from "../lib/invoice-pdf";
import { buildInvoiceEmailHtml, buildAdminInvoicePaidHtml } from "../lib/email-templates";
import { sendEmail } from "../services/email";
import { COMPANY } from "../lib/company";
import { stripe } from "../services/stripe";
import { findStripeCustomerByEmail, createStripeCustomer, voidStripeInvoice, deleteStripeInvoice } from "../services/stripe-sync";

async function ensureStripeCustomerId(client: any): Promise<string | null> {
  if (client.stripeCustomerId) return client.stripeCustomerId;
  if (!stripe) return null;
  let customerId = client.email ? await findStripeCustomerByEmail(client.email) : null;
  if (!customerId) {
    customerId = await createStripeCustomer({
      name: client.name,
      email: client.email ?? null,
      phone: client.phone ?? null,
      address: client.address ?? null,
      city: client.city ?? null,
      country: client.country ?? null,
      zipCode: client.zipCode ?? null,
    });
  }
  if (customerId) {
    await db.update(clients).set({ stripeCustomerId: customerId }).where(eq(clients.id, client.id));
  }
  return customerId;
}

async function getOrCreateCheckoutUrl(invoice: any, client: any, origin: string): Promise<string | null> {
  if (!stripe) return null;
  if (invoice.status === "paid" || invoice.status === "cancelled") return null;

  // Reuse an existing open/complete session.
  if (invoice.stripeCheckoutSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(invoice.stripeCheckoutSessionId);
      if (existing.url && (existing.status === "open" || existing.status === "complete")) {
        return existing.url;
      }
    } catch {
      // fall through and create a new session
    }
  }

  const customerId = await ensureStripeCustomerId(client);
  if (!customerId) return null;

  const metadata: Record<string, string> = {
    adminInvoiceId: String(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    clientId: String(client.id),
  };
  if (invoice.bookingId) metadata.bookingId = String(invoice.bookingId);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: `Invoice ${invoice.invoiceNumber}` },
          unit_amount: Math.round(invoice.total * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/invoices`,
    cancel_url: `${origin}/invoices`,
    customer: customerId,
    metadata,
  });

  await db.update(invoices).set({ stripeCheckoutSessionId: session.id }).where(eq(invoices.id, invoice.id));
  return session.url ?? null;
}

export const invoicesRoute = new Hono()
  .get("/", requireAuth, async (c) => {
    const all = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        clientId: invoices.clientId,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        total: invoices.total,
        paidAt: invoices.paidAt,
        reminderCount: invoices.reminderCount,
        clientName: clients.name,
        clientEmail: clients.email,
        stripePaymentIntentId: invoices.stripePaymentIntentId,
        stripeCheckoutSessionId: invoices.stripeCheckoutSessionId,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .orderBy(desc(invoices.issueDate));
    return c.json({ invoices: all }, 200);
  })
  .get("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    const invoicePayments = await db.select().from(payments).where(eq(payments.invoiceId, id));
    return c.json({ invoice, items, client, payments: invoicePayments }, 200);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json();
    const { lineItems, subtotal, vatTotal, total } = computeTotals(body.items);
    const invoiceNumber = await nextNumber("invoice", new Date().getFullYear());
    const issueDate = new Date();
    const dueDate = body.dueDate
      ? new Date(body.dueDate)
      : new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    // The Admin is the source of truth: create only the local invoice.
    // (No Stripe Native Invoice — Stripe is only the payment processor.)
    const [invoice] = await db
      .insert(invoices)
      .values({
        invoiceNumber,
        clientId: body.clientId,
        status: "draft",
        issueDate,
        dueDate,
        notes: body.notes ?? null,
        subtotal,
        vatTotal,
        total,
      })
      .returning();

    for (const item of lineItems) {
      await db.insert(invoiceItems).values({
        invoiceId: invoice!.id,
        serviceId: item.serviceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        amount: item.amount,
      });
    }

    return c.json({ invoice }, 201);
  })
  .put("/:id/status", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const { status } = await c.req.json();
    
    // Get existing invoice to check for stripeInvoiceId
    const [existingInvoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!existingInvoice) return c.json({ message: "Not found" }, 404);
    
    const values: Record<string, unknown> = { status };
    if (status === "paid") values.paidAt = new Date();
    else values.paidAt = null;
    
    // Sync status with Stripe if invoice has stripeInvoiceId
    if (existingInvoice.stripeInvoiceId) {
      if (status === "cancelled") {
        // Void the invoice in Stripe
        await voidStripeInvoice(existingInvoice.stripeInvoiceId);
      }
      // Note: "paid" status is typically synced via webhook from Stripe
    }
    
    const [invoice] = await db.update(invoices).set(values).where(eq(invoices.id, id)).returning();

    if (status === "paid" && invoice) {
      // Record a manual payment for any outstanding balance (keeps payment history consistent).
      const existingPayments = await db.select().from(payments).where(eq(payments.invoiceId, id));
      const paidSoFar = existingPayments.reduce((s, p) => s + p.amount, 0);
      const remaining = Number((invoice.total - paidSoFar).toFixed(2));
      if (remaining > 0) {
        await db.insert(payments).values({ invoiceId: id, amount: remaining, method: "manual", paidAt: new Date() });
      }
      const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
      await sendEmail({
        to: COMPANY.adminEmail,
        subject: `Invoice paid — ${invoice.invoiceNumber}`,
        html: buildAdminInvoicePaidHtml({
          clientName: client?.name ?? "Unknown",
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
        }),
      });
    }

    return c.json({ invoice }, 200);
  })
  .post("/:id/payments", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const [payment] = await db
      .insert(payments)
      .values({
        invoiceId: id,
        amount: body.amount,
        method: body.method ?? "manual",
        notes: body.notes ?? null,
      })
      .returning();

    const invoicePayments = await db.select().from(payments).where(eq(payments.invoiceId, id));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    const totalPaid = invoicePayments.reduce((s, p) => s + p.amount, 0);
    if (invoice && totalPaid >= invoice.total) {
      await db.update(invoices).set({ status: "paid", paidAt: new Date() }).where(eq(invoices.id, id));
      const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
      await sendEmail({
        to: COMPANY.adminEmail,
        subject: `Invoice paid — ${invoice.invoiceNumber}`,
        html: buildAdminInvoicePaidHtml({
          clientName: client?.name ?? "Unknown",
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
        }),
      });
    }

    return c.json({ payment }, 201);
  })
  .get("/:id/pdf", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));

    const vatBreakdown = vatBreakdownFromNet(items);

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      client: {
        name: client?.name ?? "Unknown",
        address: client?.address,
        zipCode: client?.zipCode,
        city: client?.city,
        country: client?.country,
        phone: client?.phone,
      },
      items,
      subtotal: invoice.subtotal,
      vatTotal: invoice.vatTotal,
      total: invoice.total,
      notes: invoice.notes,
      vatBreakdown,
      status: invoice.status,
      paidAt: invoice.paidAt,
    });

    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    return c.body(new Uint8Array(pdfBuffer));
  })
  .post("/:id/send", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    if (!client?.email) return c.json({ message: "Client has no email" }, 400);

    const vatBreakdown = vatBreakdownFromNet(items);

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      client,
      items,
      subtotal: invoice.subtotal,
      vatTotal: invoice.vatTotal,
      total: invoice.total,
      notes: invoice.notes,
      vatBreakdown,
      status: invoice.status,
      paidAt: invoice.paidAt,
    });

    const origin = c.req.header("origin") ?? process.env.WEBSITE_URL ?? "";
    const paymentUrl = await getOrCreateCheckoutUrl(invoice, client, origin);

    await sendEmail({
      to: client.email,
      subject: `Invoice ${invoice.invoiceNumber} — Studio Daï Oakes`,
      html: buildInvoiceEmailHtml({
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        dueDate: invoice.dueDate,
        paymentUrl,
      }),
      attachments: [{ filename: `invoice-${invoice.invoiceNumber}.pdf`, content: pdfBuffer }],
    });

    await db.update(invoices).set({ status: "sent" }).where(eq(invoices.id, id));
    return c.json({ success: true, checkoutUrl: paymentUrl }, 200);
  })
  .post("/:id/checkout", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    if (invoice.status === "cancelled") return c.json({ message: "Invoice is cancelled" }, 400);
    if (invoice.status === "paid") return c.json({ message: "Invoice is already paid" }, 400);

    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    if (!client) return c.json({ message: "Client not found" }, 404);

    const origin = c.req.header("origin") ?? process.env.WEBSITE_URL ?? "";
    const checkoutUrl = await getOrCreateCheckoutUrl(invoice, client, origin);
    if (!checkoutUrl) return c.json({ message: "Stripe not configured or could not create checkout" }, 500);

    return c.json({ checkoutUrl }, 200);
  })
  .put("/:id/edit", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const { lineItems, subtotal, vatTotal, total } = computeTotals(body.items);

    const [invoice] = await db
      .update(invoices)
      .set({
        invoiceNumber: body.invoiceNumber,
        clientId: body.clientId,
        status: body.status,
        issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        notes: body.notes ?? null,
        subtotal,
        vatTotal,
        total,
        paidAt: body.status === "paid" ? (body.paidAt ? new Date(body.paidAt) : new Date()) : null,
      })
      .where(eq(invoices.id, id))
      .returning();

    if (!invoice) return c.json({ message: "Not found" }, 404);

    // Replace items
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    for (const item of lineItems) {
      await db.insert(invoiceItems).values({
        invoiceId: invoice!.id,
        serviceId: item.serviceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        amount: item.amount,
      });
    }

    return c.json({ invoice }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    
    // Get existing invoice to check for stripeInvoiceId
    const [existingInvoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    
    // Delete invoice from Stripe if it has stripeInvoiceId and is still a draft
    if (existingInvoice?.stripeInvoiceId && existingInvoice.status === "draft") {
      await deleteStripeInvoice(existingInvoice.stripeInvoiceId);
    }
    
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await db.delete(payments).where(eq(payments.invoiceId, id));
    await db.delete(invoices).where(eq(invoices.id, id));
    return c.json({ success: true }, 200);
  });
