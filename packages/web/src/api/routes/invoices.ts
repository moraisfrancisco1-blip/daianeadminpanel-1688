import { Hono } from "hono";
import { db } from "../database";
import { invoices, invoiceItems, clients, payments, bookings, invoiceActivity, emailLog, refunds } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { computeTotals, vatBreakdownFromNet } from "../lib/totals";
import { nextNumber, nextTestNumber } from "../lib/counters";
import { generateInvoicePdf } from "../lib/invoice-pdf";
import { buildInvoiceEmailHtml, buildPaymentLinkEmailHtml, buildAdminInvoicePaidHtml } from "../lib/email-templates";
import { sendTrackedEmail } from "../services/email-log";
import { changeInvoiceStatus, recordInvoiceActivity } from "../services/invoice-activity";
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
    // Propagate metadata to the PaymentIntent so payment_intent.succeeded can also
    // identify the Admin invoice (Checkout Session metadata is NOT copied automatically).
    payment_intent_data: { metadata },
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
        isTest: invoices.isTest,
        sessionDate: bookings.date,
        sessionStartTime: bookings.startTime,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(bookings, eq(invoices.bookingId, bookings.id))
      .orderBy(desc(invoices.issueDate));

    const allRefunds = await db.select().from(refunds);
    const refundedByInvoice = new Map<number, number>();
    for (const r of allRefunds) {
      if (r.status !== "succeeded") continue;
      refundedByInvoice.set(r.invoiceId, (refundedByInvoice.get(r.invoiceId) ?? 0) + r.amount);
    }

    return c.json(
      { invoices: all.map((inv) => ({ ...inv, refundedAmount: refundedByInvoice.get(inv.id) ?? 0 })) },
      200,
    );
  })
  .get("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    const invoicePayments = await db.select().from(payments).where(eq(payments.invoiceId, id));
    const activity = await db
      .select()
      .from(invoiceActivity)
      .where(eq(invoiceActivity.invoiceId, id))
      .orderBy(desc(invoiceActivity.createdAt));
    const emails = await db
      .select()
      .from(emailLog)
      .where(eq(emailLog.invoiceId, id))
      .orderBy(desc(emailLog.createdAt));
    const invoiceRefunds = await db.select().from(refunds).where(eq(refunds.invoiceId, id));
    return c.json({ invoice, items, client, payments: invoicePayments, activity, emails, refunds: invoiceRefunds }, 200);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json();
    const { lineItems, subtotal, vatTotal, total } = computeTotals(body.items);
    const isTest = !!body.isTest;
    const invoiceNumber = isTest
      ? await nextTestNumber()
      : await nextNumber("invoice", new Date().getFullYear());
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
        isTest,
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

    await recordInvoiceActivity({
      invoiceId: invoice!.id,
      type: "created",
      newStatus: "draft",
      channel: "admin",
      amount: total,
      metadata: { isTest },
    });

    return c.json({ invoice }, 201);
  })
  .put("/:id/status", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const { status } = await c.req.json();
    
    // Get existing invoice to check for stripeInvoiceId
    const [existingInvoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!existingInvoice) return c.json({ message: "Not found" }, 404);

    // Sync status with Stripe if invoice has stripeInvoiceId
    if (existingInvoice.stripeInvoiceId) {
      if (status === "cancelled") {
        // Void the invoice in Stripe
        await voidStripeInvoice(existingInvoice.stripeInvoiceId);
      }
      // Note: "paid" status is typically synced via webhook from Stripe
    }
    
    const res = await changeInvoiceStatus(id, status, { channel: "admin", type: "status_changed" });

    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));

    if (status === "paid" && res.changed && invoice) {
      // Record a manual payment for any outstanding balance (keeps payment history consistent).
      const existingPayments = await db.select().from(payments).where(eq(payments.invoiceId, id));
      const paidSoFar = existingPayments.reduce((s, p) => s + p.amount, 0);
      const remaining = Number((invoice.total - paidSoFar).toFixed(2));
      if (remaining > 0) {
        await db.insert(payments).values({ invoiceId: id, amount: remaining, method: "manual", paidAt: new Date() });
        await recordInvoiceActivity({ invoiceId: id, type: "payment_recorded", channel: "manual", method: "manual", amount: remaining });
      }
      const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
      await sendTrackedEmail({
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

    await recordInvoiceActivity({ invoiceId: id, type: "payment_recorded", channel: "manual", method: body.method ?? "manual", amount: body.amount });
    const invoicePayments = await db.select().from(payments).where(eq(payments.invoiceId, id));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    const totalPaid = invoicePayments.reduce((s, p) => s + p.amount, 0);
    if (invoice && totalPaid >= invoice.total) {
      await changeInvoiceStatus(id, "paid", { channel: "manual", type: "status_changed" });
      const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
      await sendTrackedEmail({
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
    if (invoice.status === "paid" || invoice.status === "cancelled") return c.json({ message: "Invoice is already paid or cancelled" }, 400);
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

    // "Send Invoice" = email the invoice document (PDF). No payment link is created here;
    // "Send Payment Link" is a separate, dedicated endpoint (/send-payment-link).
    await sendTrackedEmail({
      to: client.email,
      recipientName: client.name,
      clientId: client.id,
      invoiceId: id,
      bookingId: invoice.bookingId ?? null,
      type: "invoice",
      subject: `Invoice ${invoice.invoiceNumber} — Studio Daï Oakes`,
      html: buildInvoiceEmailHtml({
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        dueDate: invoice.dueDate,
        paymentUrl: null,
      }),
      attachments: [{ filename: `invoice-${invoice.invoiceNumber}.pdf`, content: pdfBuffer }],
    });

    await changeInvoiceStatus(id, "sent", { channel: "admin", type: "sent" });
    return c.json({ success: true }, 200);
  })
  .post("/:id/send-payment-link", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    if (invoice.status === "cancelled") return c.json({ message: "Invoice is cancelled" }, 400);
    if (invoice.status === "paid") return c.json({ message: "Invoice is already paid" }, 400);

    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    if (!client) return c.json({ message: "Client not found" }, 404);
    if (!client.email) return c.json({ message: "Client has no email" }, 400);

    // Idempotent: reuses an existing open/complete Checkout Session, only creating a new
    // one when the previous link expired/failed. Never creates a duplicate invoice.
    const origin = c.req.header("origin") ?? process.env.WEBSITE_URL ?? "";
    const checkoutUrl = await getOrCreateCheckoutUrl(invoice, client, origin);
    if (!checkoutUrl) return c.json({ message: "Stripe not configured or could not create payment link" }, 500);

    // "Send Payment Link" = email only the payment link (no invoice PDF attachment).
    await sendTrackedEmail({
      to: client.email,
      recipientName: client.name,
      clientId: client.id,
      invoiceId: id,
      bookingId: invoice.bookingId ?? null,
      type: "payment_link",
      subject: `Payment link for invoice ${invoice.invoiceNumber} — Studio Daï Oakes`,
      html: buildPaymentLinkEmailHtml({
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        paymentUrl: checkoutUrl,
      }),
    });

    await changeInvoiceStatus(id, "sent", { channel: "admin", type: "payment_link_sent" });
    return c.json({ success: true, checkoutUrl }, 200);
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

    await recordInvoiceActivity({
      invoiceId: id,
      type: "payment_link_created",
      channel: "admin",
      amount: invoice.total,
      metadata: { checkoutUrl },
    });

    return c.json({ checkoutUrl }, 200);
  })
  .put("/:id/edit", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const [prevInvoice] = await db.select().from(invoices).where(eq(invoices.id, id));
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

    await recordInvoiceActivity({
      invoiceId: id,
      type: prevInvoice && prevInvoice.status !== body.status ? "status_changed" : "edited",
      oldStatus: prevInvoice?.status ?? null,
      newStatus: body.status,
      channel: "admin",
      amount: total,
    });

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
