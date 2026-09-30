import { randomUUID } from "node:crypto";
import { db } from "../database";
import { invoices, clients } from "../database/schema";
import { eq } from "drizzle-orm";
import { stripe } from "../services/stripe";
import { findStripeCustomerByEmail, createStripeCustomer } from "../services/stripe-sync";

export type CheckoutResult = { url: string } | { reason: string };

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
    }, { throwOnError: true });
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
  const result = await getCheckoutResult(invoice, client, origin);
  return "url" in result ? result.url : null;
}

/** Like getOrCreateCheckoutUrl, but says *why* no link could be produced. */
export async function getCheckoutResult(
  invoice: typeof invoices.$inferSelect,
  client: typeof clients.$inferSelect,
  origin: string,
): Promise<CheckoutResult> {
  if (!stripe) return { reason: "Stripe is not configured on the server (STRIPE_SECRET_KEY is missing)" };
  if (invoice.status === "paid" || invoice.status === "cancelled") {
    return { reason: `Invoice is ${invoice.status}` };
  }

  if (invoice.stripeCheckoutSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(invoice.stripeCheckoutSessionId);
      if (existing.url && (existing.status === "open" || existing.status === "complete")) {
        return { url: existing.url };
      }
    } catch {
      // fall through and create a new session
    }
  }

  let customerId: string | null;
  try {
    customerId = await ensureStripeCustomerId(client);
  } catch (err) {
    return { reason: `Could not get a Stripe customer for this client: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!customerId) {
    return {
      reason: client.email
        ? `Could not find or create a Stripe customer for ${client.email} (several Stripe customers may share this email, or the Stripe key is invalid)`
        : "Client has no email, so no Stripe customer could be created",
    };
  }

  const metadata: Record<string, string> = {
    adminInvoiceId: String(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    clientId: String(client.id),
  };
  if (invoice.bookingId) metadata.bookingId = String(invoice.bookingId);

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
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
  } catch (err) {
    return { reason: `Stripe rejected the checkout: ${err instanceof Error ? err.message : String(err)}` };
  }

  await db.update(invoices).set({ stripeCheckoutSessionId: session.id }).where(eq(invoices.id, invoice.id));
  return session.url ? { url: session.url } : { reason: "Stripe returned no checkout URL" };
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
