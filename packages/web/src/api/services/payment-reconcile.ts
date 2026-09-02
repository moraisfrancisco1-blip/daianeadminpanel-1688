import { db } from "../database";
import { invoices, payments } from "../database/schema";
import { eq } from "drizzle-orm";
import { stripe } from "./stripe";
import { changeInvoiceStatus, recordInvoiceActivity } from "./invoice-activity";

export type PaymentState =
  | "confirmed"
  | "awaiting"
  | "processing"
  | "attention"
  | "cancelled"
  | "unknown"
  | "refunded"
  | "partially_refunded";

export type PaymentRow = {
  invoiceId: number;
  invoiceNumber: string;
  clientId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  total: number;
  status: string;
  paidAt: Date | null;
  sessionDate: string | null;
  sessionStartTime: string | null;
  stripeCheckoutStatus: string | null;
  stripePaymentIntentStatus: string | null;
  lastStripeVerifiedAt: Date | null;
  hasPayment: boolean;
  paymentMethod: string | null;
  state: PaymentState;
  problem: string | null;
  verified: boolean;
};

/** Derive the operational payment state from DB + stored Stripe snapshot (no live call). */
export function derivePaymentState(
  invoice: any,
  hasPayment: boolean,
  refundedAmount = 0,
): { state: PaymentState; problem: string | null } {
  if (invoice.status === "cancelled") return { state: "cancelled", problem: null };
  const cs = invoice.stripeCheckoutStatus;
  const pi = invoice.stripePaymentIntentStatus;

  if (invoice.status === "paid") {
    if (!hasPayment) return { state: "attention", problem: "paid_but_no_payment_record" };
    if (!invoice.paidAt) return { state: "attention", problem: "paid_but_no_paid_at" };
    if (refundedAmount > 0) {
      return refundedAmount >= invoice.total ? { state: "refunded", problem: null } : { state: "partially_refunded", problem: null };
    }
    return { state: "confirmed", problem: null };
  }

  // Not paid (sent / overdue / draft)
  if (pi === "succeeded" || cs === "complete") return { state: "attention", problem: "stripe_paid_but_invoice_not_paid" };
  if (pi === "processing" || pi === "requires_action") return { state: "processing", problem: null };
  if (cs === "expired") return { state: "attention", problem: "expired_link" };
  if (pi === "requires_payment_method" || pi === "failed" || pi === "canceled") return { state: "attention", problem: "payment_failed" };
  if (cs === "open") return { state: "awaiting", problem: null };

  const hasStripeRef = !!invoice.stripeCheckoutSessionId || !!invoice.stripePaymentIntentId;
  if (hasStripeRef && !invoice.lastStripeVerifiedAt) return { state: "unknown", problem: null };
  return { state: "awaiting", problem: null };
}

/** Live verify + idempotent reconcile of ONE invoice against Stripe. */
export async function verifyAndReconcileInvoice(invoice: any): Promise<{ checked: boolean; fixed: boolean; action: string }> {
  if (!stripe) {
    await db.update(invoices).set({ lastStripeVerifiedAt: new Date() }).where(eq(invoices.id, invoice.id));
    return { checked: true, fixed: false, action: "stripe_not_configured" };
  }

  if (invoice.status === "cancelled") {
    await db.update(invoices).set({ lastStripeVerifiedAt: new Date() }).where(eq(invoices.id, invoice.id));
    return { checked: true, fixed: false, action: "cancelled_skipped" };
  }

  let csStatus: string | null = null;
  let piStatus: string | null = null;
  let confirmedPaid = false;
  let paidAt: Date | null = null;
  let piId: string | null = null;

  if (invoice.stripeCheckoutSessionId) {
    try {
      const s = await stripe.checkout.sessions.retrieve(invoice.stripeCheckoutSessionId);
      csStatus = s.status ?? null;
      if (s.payment_status === "paid") confirmedPaid = true;
      if (s.payment_intent && typeof s.payment_intent === "string") piId = s.payment_intent;
    } catch {
      csStatus = null;
    }
  }
  if (invoice.stripePaymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(invoice.stripePaymentIntentId);
      piStatus = pi.status;
      piId = pi.id;
      if (pi.status === "succeeded") { confirmedPaid = true; paidAt = new Date(pi.created * 1000); }
    } catch {
      piStatus = null;
    }
  }

  // Persist the snapshot (only real statuses, keep previous if unknown).
  await db
    .update(invoices)
    .set({
      stripeCheckoutStatus: csStatus ?? invoice.stripeCheckoutStatus ?? null,
      stripePaymentIntentStatus:
        piStatus && piStatus !== "unknown" ? piStatus : invoice.stripePaymentIntentStatus ?? null,
      lastStripeVerifiedAt: new Date(),
    })
    .where(eq(invoices.id, invoice.id));

  let fixed = false;
  let action = "verified_no_change";

  // 1) Stripe confirms paid but invoice not marked paid -> mark paid (idempotent).
  if (confirmedPaid && invoice.status !== "paid") {
    const res = await changeInvoiceStatus(invoice.id, "paid", {
      channel: "stripe",
      type: "paid",
      paidAt: paidAt ?? new Date(),
      metadata: { source: "payment_control_verify", paymentIntentId: piId },
    });
    if (res.changed) { fixed = true; action = "marked_paid"; }
  }

  // 2) Ensure a payment record exists when Stripe confirmed (idempotent by PI, else by invoice+amount).
  if (confirmedPaid) {
    const existingByPi = piId ? await db.select().from(payments).where(eq(payments.stripePaymentIntentId, piId)) : [];
    const existingForInvoice = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    const exists = existingByPi.length > 0 || existingForInvoice.length > 0;
    if (!exists) {
      await db
        .insert(payments)
        .values({
          invoiceId: invoice.id,
          amount: invoice.total,
          method: "stripe",
          paidAt: paidAt ?? invoice.paidAt ?? new Date(),
          stripePaymentIntentId: piId,
        })
        .onConflictDoNothing();
      await recordInvoiceActivity({
        invoiceId: invoice.id,
        type: "payment_confirmed",
        channel: "stripe",
        amount: invoice.total,
        method: "stripe",
        metadata: { paymentIntentId: piId, source: "payment_control_verify" },
      });
      fixed = true;
      action = action === "marked_paid" ? action : "created_payment_record";
    }
  }

  // 3) Invoice paid but paidAt missing -> fill from Stripe if safely determinable.
  if (invoice.status === "paid" && !invoice.paidAt && paidAt) {
    await db.update(invoices).set({ paidAt }).where(eq(invoices.id, invoice.id));
    fixed = true;
    action = "filled_paidAt";
  }

  // 4) Invoice paid but no payment record at all (e.g. manual) -> create one (idempotent).
  if (invoice.status === "paid") {
    const existingForInvoice = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    if (existingForInvoice.length === 0) {
      await db
        .insert(payments)
        .values({ invoiceId: invoice.id, amount: invoice.total, method: "manual", paidAt: invoice.paidAt ?? new Date() })
        .onConflictDoNothing();
      await recordInvoiceActivity({
        invoiceId: invoice.id,
        type: "payment_recorded",
        channel: "manual",
        amount: invoice.total,
        method: "manual",
        metadata: { source: "payment_control_verify" },
      });
      fixed = true;
      action = "created_payment_record";
    }
  }

  return { checked: true, fixed, action };
}
