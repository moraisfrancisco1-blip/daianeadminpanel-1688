import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings, payments } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { derivePaymentState, verifyAndReconcileInvoice } from "../services/payment-reconcile";
import { stripe } from "../services/stripe";

export const paymentControlRoute = new Hono()
  .get("/", requireAuth, async (c) => {
    const all = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        clientId: invoices.clientId,
        clientName: clients.name,
        clientEmail: clients.email,
        total: invoices.total,
        status: invoices.status,
        paidAt: invoices.paidAt,
        sessionDate: bookings.date,
        sessionStartTime: bookings.startTime,
        stripeCheckoutSessionId: invoices.stripeCheckoutSessionId,
        stripePaymentIntentId: invoices.stripePaymentIntentId,
        stripeCheckoutStatus: invoices.stripeCheckoutStatus,
        stripePaymentIntentStatus: invoices.stripePaymentIntentStatus,
        lastStripeVerifiedAt: invoices.lastStripeVerifiedAt,
        isTest: invoices.isTest,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(bookings, eq(invoices.bookingId, bookings.id))
      .orderBy(desc(invoices.issueDate));

    const allPayments = await db.select().from(payments);
    const payByInvoice = new Map<number, (typeof allPayments)[number][]>();
    for (const p of allPayments) {
      const arr = payByInvoice.get(p.invoiceId) ?? [];
      arr.push(p);
      payByInvoice.set(p.invoiceId, arr);
    }

    const rows = all.map((inv) => {
      const plist = payByInvoice.get(inv.id) ?? [];
      const { state, problem } = derivePaymentState(inv, plist.length > 0);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        clientId: inv.clientId,
        clientName: inv.clientName,
        clientEmail: inv.clientEmail,
        total: inv.total,
        status: inv.status,
        paidAt: inv.paidAt,
        sessionDate: inv.sessionDate,
        sessionStartTime: inv.sessionStartTime,
        stripeCheckoutStatus: inv.stripeCheckoutStatus,
        stripePaymentIntentStatus: inv.stripePaymentIntentStatus,
        lastStripeVerifiedAt: inv.lastStripeVerifiedAt,
        hasPayment: plist.length > 0,
        paymentMethod: plist[0]?.method ?? null,
        state,
        problem,
        verified: !!inv.lastStripeVerifiedAt,
      };
    });

    const sum = (arr: { total: number }[]) => Number(arr.reduce((s, r) => s + r.total, 0).toFixed(2));
    const confirmed = rows.filter((r) => r.state === "confirmed");
    const awaiting = rows.filter((r) => r.state === "awaiting");
    const processing = rows.filter((r) => r.state === "processing");
    const attention = rows.filter((r) => r.state === "attention");
    const cancelled = rows.filter((r) => r.state === "cancelled");
    const unknown = rows.filter((r) => r.state === "unknown");

    return c.json(
      {
        summary: {
          paidCount: confirmed.length,
          paidTotal: sum(confirmed),
          awaitingCount: awaiting.length,
          awaitingTotal: sum(awaiting),
          processingCount: processing.length,
          processingTotal: sum(processing),
          attentionCount: attention.length,
          attentionTotal: sum(attention),
          cancelledCount: cancelled.length,
          unknownCount: unknown.length,
          outstandingTotal: sum([...awaiting, ...processing, ...attention]),
          stripeConfigured: !!stripe,
        },
        payments: rows,
      },
      200,
    );
  })
  .post("/verify", requireAuth, async (c) => {
    const all = await db.select().from(invoices);
    const results: { id: number; invoiceNumber: string; action: string }[] = [];
    let fixed = 0;
    let checked = 0;
    for (const inv of all) {
      if (inv.isTest) continue;
      const r = await verifyAndReconcileInvoice(inv);
      checked++;
      if (r.fixed) fixed++;
      results.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, action: r.action });
    }
    return c.json({ checked, fixed, results }, 200);
  });
