import { Hono } from "hono";
import { db } from "../../database";
import { invoices, payments, refunds } from "../../database/schema";
import { desc } from "drizzle-orm";
import { requireServiceKey } from "../../middleware/service-key-auth";
import { derivePaymentState } from "../../services/payment-reconcile";
import { stripe } from "../../services/stripe";

/**
 * Read-only Volt Core service connector — Round 1 (Payment Control only).
 *
 * SECURITY MODEL, read this before touching this file:
 * - This route (and every route under src/api/routes/service/) is an
 *   ALLOWLIST, not a denylist. A new field on `invoices`/`clients`/
 *   `bookings` etc. does NOT appear here automatically — it has to be
 *   deliberately added to the `select(...)` below AND to the object
 *   literal that builds each response row. Two places, on purpose:
 *   the DB query never even fetches more than this endpoint is allowed
 *   to return, so a bug in the response-building code can't leak a
 *   column that was never in memory to begin with.
 * - No client name, email, or any other client PII. No booking/session
 *   date or time. No free-text field of any kind (invoice notes, payment
 *   notes, refund reason). If a future column looks financially harmless
 *   but you're not 100% sure, leave it out and ask — do not add it here
 *   to make an integration's life easier.
 * - Only GET is wired up. Every other method on this exact path returns
 *   403 explicitly (see the `.on([...])` block below) rather than relying
 *   on Hono's default 404 for an unregistered method, so "writes are
 *   rejected" is a real, tested guarantee and not just an accident of
 *   routing.
 */
export const servicePaymentControlRoute = new Hono()
  .get("/", requireServiceKey, async (c) => {
    const rows = await db
      .select({
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        clientId: invoices.clientId,
        total: invoices.total,
        status: invoices.status,
        paidAt: invoices.paidAt,
        isTest: invoices.isTest,
        stripeCheckoutSessionId: invoices.stripeCheckoutSessionId,
        stripePaymentIntentId: invoices.stripePaymentIntentId,
        stripeCheckoutStatus: invoices.stripeCheckoutStatus,
        stripePaymentIntentStatus: invoices.stripePaymentIntentStatus,
        lastStripeVerifiedAt: invoices.lastStripeVerifiedAt,
      })
      .from(invoices)
      .orderBy(desc(invoices.issueDate));

    const allPayments = await db.select({ invoiceId: payments.invoiceId, method: payments.method }).from(payments);
    const paymentsByInvoice = new Map<number, { method: string }[]>();
    for (const p of allPayments) {
      const arr = paymentsByInvoice.get(p.invoiceId) ?? [];
      arr.push({ method: p.method });
      paymentsByInvoice.set(p.invoiceId, arr);
    }

    const allRefunds = await db.select({ invoiceId: refunds.invoiceId, amount: refunds.amount, status: refunds.status }).from(refunds);
    const refundedByInvoice = new Map<number, number>();
    for (const r of allRefunds) {
      if (r.status !== "succeeded") continue;
      refundedByInvoice.set(r.invoiceId, (refundedByInvoice.get(r.invoiceId) ?? 0) + r.amount);
    }

    // Explicit allowlisted shape — every key here was chosen deliberately in
    // the Step 0 survey; nothing is spread in from the query rows above.
    const paymentRows = rows.map((inv) => {
      const plist = paymentsByInvoice.get(inv.invoiceId) ?? [];
      const refundedAmount = refundedByInvoice.get(inv.invoiceId) ?? 0;
      const { state, problem } = derivePaymentState(
        { status: inv.status, stripeCheckoutStatus: inv.stripeCheckoutStatus, stripePaymentIntentStatus: inv.stripePaymentIntentStatus, stripeCheckoutSessionId: inv.stripeCheckoutSessionId, stripePaymentIntentId: inv.stripePaymentIntentId, lastStripeVerifiedAt: inv.lastStripeVerifiedAt, paidAt: inv.paidAt, total: inv.total },
        plist.length > 0,
        refundedAmount,
      );
      return {
        invoiceId: inv.invoiceId,
        invoiceNumber: inv.invoiceNumber,
        clientId: inv.clientId,
        total: inv.total,
        status: inv.status,
        paidAt: inv.paidAt,
        isTest: inv.isTest,
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
    const confirmed = paymentRows.filter((r) => r.state === "confirmed");
    const awaiting = paymentRows.filter((r) => r.state === "awaiting");
    const processing = paymentRows.filter((r) => r.state === "processing");
    const attention = paymentRows.filter((r) => r.state === "attention");
    const cancelled = paymentRows.filter((r) => r.state === "cancelled");
    const unknown = paymentRows.filter((r) => r.state === "unknown");
    const refunded = paymentRows.filter((r) => r.state === "refunded" || r.state === "partially_refunded");

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
          refundedTotal: Number(refunded.reduce((s, r) => s + r.refundedAmount, 0).toFixed(2)),
          outstandingTotal: sum([...awaiting, ...processing, ...attention]),
          stripeConfigured: !!stripe,
        },
        payments: paymentRows,
      },
      200,
    );
  })
  // Explicit, tested rejection of every write method on this exact path —
  // not left to Hono's default 404 for an unregistered method/path pair.
  .on(["POST", "PUT", "PATCH", "DELETE"], "/", (c) => c.json({ message: "Forbidden — this connector is read-only" }, 403));
