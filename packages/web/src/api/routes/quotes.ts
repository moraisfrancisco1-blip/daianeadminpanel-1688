import { Hono } from "hono";
import { db } from "../database";
import { quotes, quoteItems, clients, invoices, invoiceItems } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { computeTotals, vatBreakdownFromNet } from "../lib/totals";
import { nextNumber } from "../lib/counters";
import { generateInvoicePdf } from "../lib/invoice-pdf";
import { buildQuoteEmailHtml } from "../lib/email-templates";
import { sendTrackedEmail } from "../services/email-log";
import { getCompanyInvoiceDetails } from "../lib/company";

export const quotesRoute = new Hono()
  .get("/", requireAuth, async (c) => {
    const all = await db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        clientId: quotes.clientId,
        status: quotes.status,
        issueDate: quotes.issueDate,
        validUntil: quotes.validUntil,
        total: quotes.total,
        convertedInvoiceId: quotes.convertedInvoiceId,
        clientName: clients.name,
      })
      .from(quotes)
      .leftJoin(clients, eq(quotes.clientId, clients.id))
      .orderBy(desc(quotes.issueDate));
    return c.json({ quotes: all }, 200);
  })
  .get("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!quote) return c.json({ message: "Not found" }, 404);
    const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, quote.clientId));
    return c.json({ quote, items, client }, 200);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json();
    const { lineItems, subtotal, vatTotal, total } = computeTotals(body.items);
    const quoteNumber = await nextNumber("quote", new Date().getFullYear());
    const [quote] = await db
      .insert(quotes)
      .values({
        quoteNumber,
        clientId: body.clientId,
        status: "draft",
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        notes: body.notes ?? null,
        subtotal,
        vatTotal,
        total,
      })
      .returning();
    for (const item of lineItems) {
      await db.insert(quoteItems).values({
        quoteId: quote!.id,
        serviceId: item.serviceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        amount: item.amount,
      });
    }
    return c.json({ quote }, 201);
  })
  .put("/:id/status", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const { status } = await c.req.json();
    const [quote] = await db.update(quotes).set({ status }).where(eq(quotes.id, id)).returning();
    return c.json({ quote }, 200);
  })
  .get("/:id/pdf", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!quote) return c.json({ message: "Not found" }, 404);
    const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, quote.clientId));

    const vatBreakdown = vatBreakdownFromNet(items);
    const company = await getCompanyInvoiceDetails();

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: quote.quoteNumber,
      issueDate: quote.issueDate,
      dueDate: quote.validUntil ?? new Date(quote.issueDate.getTime() + 30 * 24 * 60 * 60 * 1000),
      documentLabel: "QUOTE",
      dueDateLabel: "Valid until",
      client: {
        name: client?.name ?? "Unknown",
        address: client?.address,
        zipCode: client?.zipCode,
        city: client?.city,
        country: client?.country,
        phone: client?.phone,
      },
      items,
      subtotal: quote.subtotal,
      vatTotal: quote.vatTotal,
      total: quote.total,
      notes: quote.notes,
      vatBreakdown,
      status: quote.status,
      company,
    });

    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `attachment; filename="quote-${quote.quoteNumber}.pdf"`);
    return c.body(new Uint8Array(pdfBuffer));
  })
  .post("/:id/send", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!quote) return c.json({ message: "Not found" }, 404);
    if (quote.convertedInvoiceId) return c.json({ message: "Quote was already converted to an invoice" }, 400);
    const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, quote.clientId));
    if (!client?.email) return c.json({ message: "Client has no email" }, 400);

    const vatBreakdown = vatBreakdownFromNet(items);
    const company = await getCompanyInvoiceDetails();

    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber: quote.quoteNumber,
      issueDate: quote.issueDate,
      dueDate: quote.validUntil ?? new Date(quote.issueDate.getTime() + 30 * 24 * 60 * 60 * 1000),
      documentLabel: "QUOTE",
      dueDateLabel: "Valid until",
      client,
      items,
      subtotal: quote.subtotal,
      vatTotal: quote.vatTotal,
      total: quote.total,
      notes: quote.notes,
      vatBreakdown,
      status: quote.status,
      company,
    });

    await sendTrackedEmail({
      to: client.email,
      recipientName: client.name,
      clientId: client.id,
      type: "quote",
      subject: `Quote ${quote.quoteNumber} — Studio Daï Oakes`,
      html: buildQuoteEmailHtml({ clientName: client.name, quoteNumber: quote.quoteNumber, total: quote.total, validUntil: quote.validUntil }),
      attachments: [{ filename: `quote-${quote.quoteNumber}.pdf`, content: pdfBuffer }],
    });

    if (quote.status === "draft") {
      await db.update(quotes).set({ status: "sent" }).where(eq(quotes.id, id));
    }
    return c.json({ success: true }, 200);
  })
  .post("/:id/convert", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!quote) return c.json({ message: "Not found" }, 404);
    const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, id));

    const invoiceNumber = await nextNumber("invoice", new Date().getFullYear());
    const issueDate = new Date();
    const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [invoice] = await db
      .insert(invoices)
      .values({
        invoiceNumber,
        clientId: quote.clientId,
        quoteId: quote.id,
        status: "draft",
        issueDate,
        dueDate,
        notes: quote.notes,
        subtotal: quote.subtotal,
        vatTotal: quote.vatTotal,
        total: quote.total,
      })
      .returning();

    for (const item of items) {
      await db.insert(invoiceItems).values({
        invoiceId: invoice!.id,
        serviceId: item.serviceId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        amount: item.amount,
      });
    }

    await db.update(quotes).set({ status: "accepted", convertedInvoiceId: invoice!.id }).where(eq(quotes.id, id));

    return c.json({ invoice }, 201);
  })
  .put("/:id/edit", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const { lineItems, subtotal, vatTotal, total } = computeTotals(body.items);
    
    const [quote] = await db
      .update(quotes)
      .set({
        clientId: body.clientId,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        notes: body.notes ?? null,
        subtotal,
        vatTotal,
        total,
      })
      .where(eq(quotes.id, id))
      .returning();

    if (!quote) return c.json({ message: "Not found" }, 404);

    // Remove old items and insert new ones
    await db.delete(quoteItems).where(eq(quoteItems.quoteId, id));
    for (const item of lineItems) {
      await db.insert(quoteItems).values({
        quoteId: quote!.id,
        serviceId: item.serviceId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        amount: item.amount,
      });
    }
    return c.json({ quote }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    await db.delete(quoteItems).where(eq(quoteItems.quoteId, id));
    await db.delete(quotes).where(eq(quotes.id, id));
    return c.json({ success: true }, 200);
  });
