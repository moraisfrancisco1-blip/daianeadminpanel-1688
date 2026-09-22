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
import { COMPANY, getCompanyInvoiceDetails } from "../lib/company";
import { stripe } from "../services/stripe";
import { voidStripeInvoice, deleteStripeInvoice } from "../services/stripe-sync";
import { getOrCreateCheckoutUrl, ensurePayToken, payUrl } from "../lib/invoice-checkout";

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

    let invoiceNumber: string;
    if (body.invoiceNumber) {
      const [existing] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, body.invoiceNumber));
      if (existing) return c.json({ message: `Invoice number ${body.invoiceNumber} is already in use` }, 400);
      invoiceNumber = body.invoiceNumber;
    } else {
      invoiceNumber = isTest ? await nextTestNumber() : await nextNumber("invoice", new Date().getFullYear());
    }

    const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
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
    const company = await getCompanyInvoiceDetails();

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
      company,
    });

    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    return c.body(new Uint8Array(pdfBuffer));
  })
  .post("/:id/send", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    if (invoice.status === "cancelled") return c.json({ message: "Invoice is cancelled" }, 400);
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    if (!client?.email) return c.json({ message: "Client has no email" }, 400);

    const vatBreakdown = vatBreakdownFromNet(items);
    const company = await getCompanyInvoiceDetails();

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
      company,
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

    // A resend of an already-paid invoice (e.g. the client says they never got
    // it) stays "paid" — only draft/sent/overdue invoices transition to "sent".
    if (invoice.status !== "paid") {
      await changeInvoiceStatus(id, "sent", { channel: "admin", type: "sent" });
    } else {
      await recordInvoiceActivity({ invoiceId: id, type: "sent", channel: "admin", recipientEmail: client.email });
    }
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

    // Priming a live Checkout Session now is not required for the durable link to work — it
    // creates one lazily on first click — but doing it here surfaces a Stripe misconfiguration
    // immediately instead of only when the client actually clicks.
    const origin = c.req.header("origin") ?? process.env.WEBSITE_URL ?? "";
    const primed = await getOrCreateCheckoutUrl(invoice, client, origin);
    if (!primed) return c.json({ message: "Stripe not configured or could not create payment link" }, 500);

    // Our own domain, never Stripe's directly: Stripe caps a Checkout Session at 24h, so a
    // one-time link emailed today would be dead by the time an out-of-town client pays next week.
    const durableUrl = payUrl(await ensurePayToken(invoice));

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
        paymentUrl: durableUrl,
      }),
    });

    await changeInvoiceStatus(id, "sent", { channel: "admin", type: "payment_link_sent" });
    return c.json({ success: true, checkoutUrl: durableUrl }, 200);
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
    const primed = await getOrCreateCheckoutUrl(invoice, client, origin);
    if (!primed) return c.json({ message: "Stripe not configured or could not create checkout" }, 500);

    // Our own domain, never Stripe's directly — see /send-payment-link for why.
    const durableUrl = payUrl(await ensurePayToken(invoice));

    await recordInvoiceActivity({
      invoiceId: id,
      type: "payment_link_created",
      channel: "admin",
      amount: invoice.total,
      metadata: { checkoutUrl: durableUrl },
    });

    return c.json({ checkoutUrl: durableUrl }, 200);
  })
  .put("/:id/edit", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const [prevInvoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    const { lineItems, subtotal, vatTotal, total } = computeTotals(body.items);

    // Repurposing a cancelled invoice's number for a different client (common
    // practice to avoid gaps in the numbering for the accountant) must reset
    // it to a clean draft — otherwise it stays "cancelled" forever and drags
    // along the old client's Stripe/payment history, which no longer applies.
    const isRepurposedCancelled =
      !!prevInvoice &&
      prevInvoice.status === "cancelled" &&
      body.clientId != null &&
      Number(body.clientId) !== prevInvoice.clientId;

    // A payment link created before this edit still charges the OLD amount (the
    // checkout session is reused as-is), so when the total changes on an unpaid
    // invoice, retire it — a fresh link at the new amount is made on demand.
    const staleCheckoutSessionId =
      prevInvoice && prevInvoice.status !== "paid" && prevInvoice.stripeCheckoutSessionId && prevInvoice.total !== total
        ? prevInvoice.stripeCheckoutSessionId
        : null;
    if (staleCheckoutSessionId && stripe) {
      try {
        await stripe.checkout.sessions.expire(staleCheckoutSessionId);
      } catch (err) {
        // Already expired/completed — nothing to retire; the link is dropped from the invoice below anyway.
        console.warn("[invoices] could not expire old checkout session", staleCheckoutSessionId, err);
      }
    }

    const [invoice] = await db
      .update(invoices)
      .set({
        invoiceNumber: body.invoiceNumber,
        clientId: body.clientId,
        status: isRepurposedCancelled ? "draft" : body.status,
        issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        notes: body.notes ?? null,
        subtotal,
        vatTotal,
        total,
        paidAt: body.status === "paid" ? (body.paidAt ? new Date(body.paidAt) : new Date()) : null,
        ...(staleCheckoutSessionId ? { stripeCheckoutSessionId: null, stripeCheckoutStatus: null } : {}),
        ...(isRepurposedCancelled
          ? {
              bookingId: null,
              lastReminderAt: null,
              reminderCount: 0,
              stripeInvoiceId: null,
              stripePaymentIntentId: null,
              stripeCheckoutSessionId: null,
              stripeCheckoutStatus: null,
              stripePaymentIntentStatus: null,
              lastStripeVerifiedAt: null,
            }
          : {}),
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

    if (isRepurposedCancelled) {
      await recordInvoiceActivity({
        invoiceId: id,
        type: "status_changed",
        oldStatus: "cancelled",
        newStatus: "draft",
        channel: "admin",
        amount: total,
        metadata: { reason: "repurposed_for_new_client", previousClientId: prevInvoice!.clientId },
      });
    } else {
      await recordInvoiceActivity({
        invoiceId: id,
        type: prevInvoice && prevInvoice.status !== body.status ? "status_changed" : "edited",
        oldStatus: prevInvoice?.status ?? null,
        newStatus: body.status,
        channel: "admin",
        amount: total,
      });
    }

    return c.json({ invoice }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));

    const [existingInvoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!existingInvoice) return c.json({ message: "Not found" }, 404);

    // Only a draft (never sent, never paid, no official record anywhere else)
    // can be permanently deleted. Anything sent or paid must be cancelled
    // instead — it keeps the invoice number and audit trail intact for
    // accounting purposes rather than leaving an unexplained gap.
    if (existingInvoice.status !== "draft") {
      return c.json({ message: "Only draft invoices can be deleted. Cancel this invoice instead to keep its number in the record." }, 400);
    }

    if (existingInvoice.stripeInvoiceId) {
      await deleteStripeInvoice(existingInvoice.stripeInvoiceId);
    }

    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await db.delete(payments).where(eq(payments.invoiceId, id));
    await db.delete(invoices).where(eq(invoices.id, id));
    // Without this the booking keeps pointing at a deleted invoice, which hides
    // "Generate invoice" and breaks "Send invoice" for it.
    await db.update(bookings).set({ invoiceId: null }).where(eq(bookings.invoiceId, id));
    return c.json({ success: true }, 200);
  });
