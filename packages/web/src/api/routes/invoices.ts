import { Hono } from "hono";
import { db } from "../database";
import { invoices, invoiceItems, clients, payments } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { computeTotals } from "../lib/totals";
import { nextNumber } from "../lib/counters";
import { generateInvoicePdf } from "../lib/invoice-pdf";
import { buildInvoiceEmailHtml, buildAdminInvoicePaidHtml } from "../lib/email-templates";
import { sendEmail } from "../services/email";
import { COMPANY } from "../lib/company";
import { createStripeInvoice, finalizeStripeInvoice, voidStripeInvoice, deleteStripeInvoice } from "../services/stripe-sync";

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

    // Get client to check for stripeCustomerId
    const [client] = await db.select().from(clients).where(eq(clients.id, body.clientId));
    
    // Create invoice in Stripe if client has stripeCustomerId
    let stripeInvoiceId: string | null = null;
    let stripePaymentIntentId: string | null = null;
    
    if (client?.stripeCustomerId) {
      const stripeResult = await createStripeInvoice({
        stripeCustomerId: client.stripeCustomerId,
        invoiceNumber,
        issueDate,
        dueDate,
        items: lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
        })),
        notes: body.notes ?? null,
      });
      
      if (stripeResult) {
        stripeInvoiceId = stripeResult.stripeInvoiceId;
        stripePaymentIntentId = stripeResult.stripePaymentIntentId;
      }
    }

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
        stripeInvoiceId,
        stripePaymentIntentId,
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

    const { vatBreakdown } = computeTotals(
      items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, vatRate: i.vatRate })),
    );

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

    const { vatBreakdown } = computeTotals(
      items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, vatRate: i.vatRate })),
    );

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

    await sendEmail({
      to: client.email,
      subject: `Invoice ${invoice.invoiceNumber} — Studio Daï Oakes`,
      html: buildInvoiceEmailHtml({
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        dueDate: invoice.dueDate,
      }),
      attachments: [{ filename: `invoice-${invoice.invoiceNumber}.pdf`, content: pdfBuffer }],
    });

    // Finalize invoice in Stripe if it has stripeInvoiceId
    if (invoice.stripeInvoiceId) {
      await finalizeStripeInvoice(invoice.stripeInvoiceId);
    }

    await db.update(invoices).set({ status: "sent" }).where(eq(invoices.id, id));
    return c.json({ success: true }, 200);
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
