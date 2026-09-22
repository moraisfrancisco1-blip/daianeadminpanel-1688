import { randomUUID } from "node:crypto";
import { db } from "../database";
import { invoices, clients } from "../database/schema";
import { eq } from "drizzle-orm";
import { stripe } from "../services/stripe";
import { findStripeCustomerByEmail, createStripeCustomer } from "../services/stripe-sync";

async function ensureStripeCustomerId(client: typeof clients.$inferSelect): Promise<string | null> {
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

/**
 * A live Stripe Checkout URL for this invoice — reuses an existing open/complete
 * session, or creates a fresh one otherwise (the previous one expired, or none
 * exists yet). Stripe caps a one-time Checkout Session at 24h, so this is never
 * called just once and cached forever: see payUrl()/the /pay/:token redirect,
 * which calls this again on every click so the link handed to a client never
 * itself goes stale, however old it is.
 */
export async function getOrCreateCheckoutUrl(
  invoice: typeof invoices.$inferSelect,
  client: typeof clients.$inferSelect,
  origin: string,
): Promise<string | null> {
  if (!stripe) return null;
  if (invoice.status === "paid" || invoice.status === "cancelled") return null;

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
    success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/payment-cancelled`,
    customer: customerId,
    metadata,
    // Propagate metadata to the PaymentIntent so payment_intent.succeeded can also
    // identify the Admin invoice (Checkout Session metadata is NOT copied automatically).
    payment_intent_data: { metadata },
  });

  await db.update(invoices).set({ stripeCheckoutSessionId: session.id }).where(eq(invoices.id, invoice.id));
  return session.url ?? null;
}

export const PAY_TOKEN_RE = /^[a-f0-9]{32}$/;

/** A stable, unguessable id for this invoice's durable payment link — created once, reused forever. */
export async function ensurePayToken(invoice: { id: number; payToken: string | null }): Promise<string> {
  if (invoice.payToken) return invoice.payToken;
  const token = randomUUID().replace(/-/g, "");
  await db.update(invoices).set({ payToken: token }).where(eq(invoices.id, invoice.id));
  return token;
}

/**
 * The link to actually hand to a client (email, WhatsApp, copy/paste) — our own
 * domain, never Stripe's. It always forwards to a live Checkout session at the
 * moment it's clicked, so it keeps working no matter how long ago it was sent.
 */
export function payUrl(token: string): string {
  const base = (process.env.WEBSITE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/payments/pay/${token}`;
}
