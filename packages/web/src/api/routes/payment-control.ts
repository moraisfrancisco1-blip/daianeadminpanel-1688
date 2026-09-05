import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings, payments, refunds } from "../database/schema";
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

    const allRefunds = await db.select().from(refunds);
    const refundedByInvoice = new Map<number, number>();
    for (const r of allRefunds) {
      if (r.status !== "succeeded") continue;
      refundedByInvoice.set(r.invoiceId, (refundedByInvoice.get(r.invoiceId) ?? 0) + r.amount);
    }

    const rows = all.map((inv) => {
      const plist = payByInvoice.get(inv.id) ?? [];
      const refundedAmount = refundedByInvoice.get(inv.id) ?? 0;
      const { state, problem } = derivePaymentState(inv, plist.length > 0, refundedAmount);
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
        refundedAmount,
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
    const refunded = rows.filter((r) => r.state === "refunded" || r.state === "partially_refunded");
    const refundedTotal = Number(refunded.reduce((s, r) => s + r.refundedAmount, 0).toFixed(2));

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
          refundedCount: refunded.length,
          refundedTotal,
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
    const allPayments = await db.select().from(payments);
    const hasPaymentByInvoice = new Set(allPayments.map((p) => p.invoiceId));
    const allRefunds = await db.select().from(refunds);
    const refundedByInvoice = new Map<number, number>();
    for (const r of allRefunds) {
      if (r.status !== "succeeded") continue;
      refundedByInvoice.set(r.invoiceId, (refundedByInvoice.get(r.invoiceId) ?? 0) + r.amount);
    }

    const results: { id: number; invoiceNumber: string; action: string }[] = [];
    let fixed = 0;
    let checked = 0;
    let skipped = 0;
    for (const inv of all) {
      if (inv.isTest) continue;

      // Skip a live Stripe round-trip for invoices that are already fully
      // settled (confirmed/cancelled/refunded) or never had a Stripe checkout
      // to begin with (cash, manual, or package-paid bookings) — their state
      // cannot change, so there's nothing left to reconcile.
      const hasStripeRef = !!inv.stripeCheckoutSessionId || !!inv.stripePaymentIntentId;
      const { state } = derivePaymentState(inv, hasPaymentByInvoice.has(inv.id), refundedByInvoice.get(inv.id) ?? 0);
      const settled = state === "confirmed" || state === "cancelled" || state === "refunded" || state === "partially_refunded";
      if (!hasStripeRef || settled) {
        skipped++;
        continue;
      }

      const r = await verifyAndReconcileInvoice(inv);
      checked++;
      if (r.fixed) fixed++;
      results.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, action: r.action });
    }
    return c.json({ checked, fixed, skipped, results }, 200);
  });
