import { stripe } from "./stripe";
import { db } from "../database";
import { clients, invoices } from "../database/schema";
import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { changeInvoiceStatus } from "./invoice-activity";

/** Normalize an email for stable comparison (trim + lowercase). Never changes stored data. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const t = email.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** Stable idempotency key derived from an email (guards Stripe customer creation against concurrent duplicates). */
function customerIdempotencyKey(email: string): string {
  return "customer-" + createHash("sha256").update(email).digest("hex").slice(0, 24);
}

/** Returns the IDs of Stripe customers matching a normalized email (empty if none or error). */
async function listStripeCustomersByEmail(normalizedEmail: string): Promise<string[]> {
  if (!stripe) return [];
  try {
    const res = await stripe.customers.list({ email: normalizedEmail, limit: 10 });
    return res.data.filter((c) => normalizeEmail(c.email) === normalizedEmail).map((c) => c.id);
  } catch (err) {
    console.error("[stripe-sync] Error listing Stripe customers by email:", err);
    return [];
  }
}

/** Returns the single Stripe customer id matching an email, or null (0 or multiple matches). */
export async function findStripeCustomerByEmail(email: string | null | undefined): Promise<string | null> {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const ids = await listStripeCustomersByEmail(norm);
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) {
    console.warn(`[stripe-sync] Multiple Stripe customers for email ${norm} — manual review needed:`, ids);
  }
  return null;
}

/**
 * Creates a customer in Stripe and returns the Stripe customer ID
 */
export async function createStripeCustomer(client: {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  zipCode: string | null;
}): Promise<string | null> {
  if (!stripe) {
    console.warn("[stripe-sync] Stripe not configured, skipping customer creation");
    return null;
  }

  const email = normalizeEmail(client.email);

  try {
    // 1. If an email exists, look for an existing Stripe customer first (avoids duplicates).
    if (email) {
      const existingIds = await listStripeCustomersByEmail(email);
      if (existingIds.length === 1) {
        console.log(`[stripe-sync] Reusing existing Stripe customer ${existingIds[0]} for email ${email}`);
        return existingIds[0];
      }
      if (existingIds.length > 1) {
        console.warn(`[stripe-sync] Multiple Stripe customers for email ${email} — NOT creating a new one, manual review needed:`, existingIds);
        return null;
      }
    }

    // 2. Create a new customer (idempotent by email to guard against concurrent duplicate creation).
    const customer = await stripe.customers.create(
      {
        name: client.name,
        email: client.email ?? undefined,
        phone: client.phone ?? undefined,
        address: client.address
          ? {
              line1: client.address,
              city: client.city ?? undefined,
              country: client.country ?? "NL",
              postal_code: client.zipCode ?? undefined,
            }
          : undefined,
        metadata: {
          source: "admin-panel",
        },
      },
      email ? { idempotencyKey: customerIdempotencyKey(email) } : undefined,
    );

    return customer.id;
  } catch (error) {
    console.error("[stripe-sync] Error creating customer in Stripe:", error);
    return null;
  }
}

/**
 * Updates a customer in Stripe
 */
export async function updateStripeCustomer(
  stripeCustomerId: string,
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    zipCode: string | null;
  }
): Promise<boolean> {
  if (!stripe) {
    console.warn("[stripe-sync] Stripe not configured, skipping customer update");
    return false;
  }

  try {
    await stripe.customers.update(stripeCustomerId, {
      name: client.name,
      email: client.email ?? undefined,
      phone: client.phone ?? undefined,
      address: client.address
        ? {
            line1: client.address,
            city: client.city ?? undefined,
            country: client.country ?? "NL",
            postal_code: client.zipCode ?? undefined,
          }
        : undefined,
    });

    return true;
  } catch (error) {
    console.error("[stripe-sync] Error updating customer in Stripe:", error);
    return false;
  }
}

/**
 * Deletes a customer from Stripe
 */
export async function deleteStripeCustomer(stripeCustomerId: string): Promise<boolean> {
  if (!stripe) {
    console.warn("[stripe-sync] Stripe not configured, skipping customer deletion");
    return false;
  }

  try {
    await stripe.customers.del(stripeCustomerId);
    return true;
  } catch (error) {
    console.error("[stripe-sync] Error deleting customer from Stripe:", error);
    return false;
  }
}

/**
 * Finds a client in the local database by Stripe customer ID
 */
export async function findClientByStripeCustomerId(stripeCustomerId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.stripeCustomerId, stripeCustomerId));
  return client ?? null;
}

/**
 * Syncs a Stripe customer to the local database (creates or updates)
 */
export async function syncStripeCustomerToLocal(stripeCustomer: {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: { line1: string | null; city: string | null; country: string | null; postal_code: string | null } | null;
}): Promise<number | null> {
  if (!stripeCustomer.name) {
    console.warn("[stripe-sync] Customer has no name, skipping sync");
    return null;
  }

  const clientData = {
    name: stripeCustomer.name,
    email: stripeCustomer.email,
    phone: stripeCustomer.phone,
    address: stripeCustomer.address?.line1,
    city: stripeCustomer.address?.city,
    country: stripeCustomer.address?.country,
    zipCode: stripeCustomer.address?.postal_code,
    stripeCustomerId: stripeCustomer.id,
  };

  // 1. Authoritative match: stripe_customer_id.
  const existingById = await findClientByStripeCustomerId(stripeCustomer.id);
  if (existingById) {
    const [updated] = await db
      .update(clients)
      .set(clientData)
      .where(eq(clients.id, existingById.id))
      .returning();
    return updated?.id ?? null;
  }

  // 2. Fallback: normalized email (avoids local duplicates when a customer is created outside the admin).
  const email = normalizeEmail(stripeCustomer.email);
  if (email) {
    const byEmail = await db.select().from(clients).where(sql`lower(trim(${clients.email})) = ${email}`);
    if (byEmail.length === 1) {
      const [updated] = await db
        .update(clients)
        .set(clientData)
        .where(eq(clients.id, byEmail[0].id))
        .returning();
      return updated?.id ?? null;
    }
    if (byEmail.length > 1) {
      console.warn(`[stripe-sync] Multiple local clients for email ${email} — not linking Stripe customer ${stripeCustomer.id} automatically`);
      return null;
    }
  }

  // 3. No safe match: create a new local client.
  const [created] = await db.insert(clients).values(clientData).returning();
  return created?.id ?? null;
}

// ==================== INVOICE SYNC ====================

/**
 * Creates an invoice in Stripe and returns the Stripe invoice ID
 * The client must have a stripeCustomerId for this to work
 */
export async function createStripeInvoice(params: {
  stripeCustomerId: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
  }>;
  notes?: string | null;
}): Promise<{ stripeInvoiceId: string; stripePaymentIntentId: string | null } | null> {
  if (!stripe) {
    console.warn("[stripe-sync] Stripe not configured, skipping invoice creation");
    return null;
  }

  try {
    // Create the invoice in Stripe
    const stripeInvoice = await stripe.invoices.create({
      customer: params.stripeCustomerId,
      auto_advance: false, // Keep as draft initially
      collection_method: "send_invoice",
      days_until_due: Math.ceil((params.dueDate.getTime() - params.issueDate.getTime()) / (1000 * 60 * 60 * 24)),
      metadata: {
        invoice_number: params.invoiceNumber,
        source: "admin-panel",
      },
    });

    // Add line items to the invoice
    for (const item of params.items) {
      await stripe.invoiceItems.create({
        customer: params.stripeCustomerId,
        invoice: stripeInvoice.id,
        amount: Math.round(item.unitPrice * item.quantity * 100), // Convert to cents
        currency: "eur",
        description: item.description,
        quantity: item.quantity,
        metadata: {
          vat_rate: String(item.vatRate),
        },
      });
    }

    // Retrieve the updated invoice to get the payment intent
    const retrievedInvoice = await stripe.invoices.retrieve(stripeInvoice.id);
    const invoiceData = retrievedInvoice as unknown as { id: string; payment_intent?: string | { id: string } | null };
    const paymentIntentId = typeof invoiceData.payment_intent === "string" 
      ? invoiceData.payment_intent 
      : invoiceData.payment_intent?.id ?? null;

    return {
      stripeInvoiceId: invoiceData.id,
      stripePaymentIntentId: paymentIntentId,
    };
  } catch (error) {
    console.error("[stripe-sync] Error creating invoice in Stripe:", error);
    return null;
  }
}

/**
 * Finalizes (sends) an invoice in Stripe
 */
export async function finalizeStripeInvoice(stripeInvoiceId: string): Promise<boolean> {
  if (!stripe) {
    console.warn("[stripe-sync] Stripe not configured, skipping invoice finalization");
    return false;
  }

  try {
    await stripe.invoices.finalizeInvoice(stripeInvoiceId);
    return true;
  } catch (error) {
    console.error("[stripe-sync] Error finalizing invoice in Stripe:", error);
    return false;
  }
}

/**
 * Voids an invoice in Stripe
 */
export async function voidStripeInvoice(stripeInvoiceId: string): Promise<boolean> {
  if (!stripe) {
    console.warn("[stripe-sync] Stripe not configured, skipping invoice void");
    return false;
  }

  try {
    await stripe.invoices.voidInvoice(stripeInvoiceId);
    return true;
  } catch (error) {
    console.error("[stripe-sync] Error voiding invoice in Stripe:", error);
    return false;
  }
}

/**
 * Deletes a draft invoice from Stripe
 */
export async function deleteStripeInvoice(stripeInvoiceId: string): Promise<boolean> {
  if (!stripe) {
    console.warn("[stripe-sync] Stripe not configured, skipping invoice deletion");
    return false;
  }

  try {
    await stripe.invoices.del(stripeInvoiceId);
    return true;
  } catch (error) {
    console.error("[stripe-sync] Error deleting invoice from Stripe:", error);
    return false;
  }
}

/**
 * Finds an invoice in the local database by Stripe invoice ID
 */
export async function findInvoiceByStripeInvoiceId(stripeInvoiceId: string) {
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.stripeInvoiceId, stripeInvoiceId));
  return invoice ?? null;
}

/**
 * Syncs invoice status from Stripe to local database
 */
export async function syncStripeInvoiceStatus(stripeInvoiceId: string, status: string, paidAt?: Date | null): Promise<boolean> {
  const existingInvoice = await findInvoiceByStripeInvoiceId(stripeInvoiceId);
  if (!existingInvoice) {
    console.warn("[stripe-sync] Invoice not found locally:", stripeInvoiceId);
    return false;
  }

  // Map Stripe status to local status
  let localStatus: string;
  switch (status) {
    case "draft":
      localStatus = "draft";
      break;
    case "open":
    case "uncollectible":
    case "sent":
      localStatus = "sent";
      break;
    case "paid":
      localStatus = "paid";
      break;
    case "void":
    case "cancelled":
      localStatus = "cancelled";
      break;
    default:
      localStatus = existingInvoice.status;
  }

  // Route through the central idempotent transition so the audit trail is recorded.
  // Only an actual status change writes an activity row (repeated Stripe updates are no-ops).
  await changeInvoiceStatus(existingInvoice.id, localStatus, {
    channel: "stripe",
    paidAt: localStatus === "paid" ? paidAt ?? new Date() : null,
    metadata: { stripeInvoiceId },
  });
  return true;
}
