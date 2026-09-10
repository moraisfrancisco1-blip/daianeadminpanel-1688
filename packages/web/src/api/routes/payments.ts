import { Hono } from "hono";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { stripe } from "../services/stripe";
import { db } from "../database";
import { invoices, bookings, services, clients, invoiceItems } from "../database/schema";
import { COMPANY } from "../lib/company";

/**
 * PUBLIC payment endpoints (no auth).
 *
 * These power the post-payment landing pages (/payment-success). A client who
 * has just paid is NOT logged into the Admin Panel, so this route must never
 * sit behind authMiddleware/requireAuth. It is registered in src/api/index.ts
 * BEFORE the auth middleware (alongside the Stripe webhook) and rate-limited
 * by IP because it is reachable without a session.
 *
 * Security model: the confirmation is read straight from Stripe — the browser
 * only supplies the Checkout Session id (which Stripe itself appends to the
 * success_url). We never trust a "paid" flag coming from the client. Only the
 * minimal fields the landing page needs are returned.
 */
export const paymentsRoute = new Hono();

paymentsRoute.get("/checkout-session/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  if (!stripe) {
    return c.json({ found: false, message: "Payments are not configured" }, 503);
  }

  // Stripe Checkout Session ids always look like "cs_test_..." / "cs_live_...".
  // Reject anything else before hitting the Stripe API.
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return c.json({ found: false, message: "Invalid session id" }, 400);
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    // Not in this Stripe account (or expired beyond retrieval) — treat as unknown.
    return c.json({ found: false, message: "Session not found" }, 404);
  }

  // The source of truth for "is it paid" is Stripe, not the query string.
  const paymentStatus = session.payment_status; // paid | unpaid | no_payment_required
  const checkoutStatus = session.status; // open | complete | expired
  const confirmed = paymentStatus === "paid" && checkoutStatus === "complete";

  const amount = Number(((session.amount_total ?? 0) / 100).toFixed(2));
  const currency = (session.currency ?? "eur").toLowerCase();

  const adminInvoiceId = session.metadata?.adminInvoiceId ? Number(session.metadata.adminInvoiceId) : null;
  const metaBookingId = session.metadata?.bookingId ? Number(session.metadata.bookingId) : null;

  // Locate the related booking (metadata first) so we can also resolve an
  // invoice through it when the session id is not stored on the invoice.
  let booking: typeof bookings.$inferSelect | undefined;
  if (metaBookingId) {
    [booking] = await db.select().from(bookings).where(eq(bookings.id, metaBookingId));
  }

  // Locate the local invoice (source of truth for numbering) — by metadata id,
  // then by the stored checkout session id, then via the booking's invoice.
  let invoice: typeof invoices.$inferSelect | undefined;
  if (adminInvoiceId) {
    [invoice] = await db.select().from(invoices).where(eq(invoices.id, adminInvoiceId));
  }
  if (!invoice) {
    [invoice] = await db.select().from(invoices).where(eq(invoices.stripeCheckoutSessionId, session.id));
  }
  if (!invoice && booking?.invoiceId) {
    [invoice] = await db.select().from(invoices).where(eq(invoices.id, booking.invoiceId));
  }
  if (!booking && invoice?.bookingId) {
    [booking] = await db.select().from(bookings).where(eq(bookings.id, invoice.bookingId));
  }

  // Service name — from the booking's service, else the first invoice line.
  let serviceName: string | null = null;
  if (booking?.serviceId) {
    const [svc] = await db.select().from(services).where(eq(services.id, booking.serviceId));
    serviceName = svc?.name ?? null;
  }
  if (!serviceName && invoice) {
    const [item] = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
    serviceName = item?.description ?? null;
  }

  // Client identity — prefer Stripe's own customer details, fall back to the
  // local client record linked to the invoice.
  let customerName: string | null = session.customer_details?.name ?? null;
  let customerEmail: string | null = session.customer_details?.email ?? session.customer_email ?? null;
  if ((!customerName || !customerEmail) && invoice) {
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    customerName = customerName ?? client?.name ?? null;
    customerEmail = customerEmail ?? client?.email ?? null;
  }

  return c.json(
    {
      found: true,
      confirmed,
      paymentStatus,
      checkoutStatus,
      amount,
      currency,
      customerName,
      customerEmail,
      invoiceNumber: invoice?.invoiceNumber ?? session.metadata?.invoiceNumber ?? null,
      serviceName,
      date: booking?.date ?? null,
      startTime: booking?.startTime ?? null,
      // Reuse the studio's existing Google Business review link (COMPANY config).
      googleReviewUrl: COMPANY.googleReviewUrl,
    },
    200,
  );
});
