import { stripe } from "./stripe";
import { db } from "../database";
import { clients, invoices } from "../database/schema";
import { eq } from "drizzle-orm";

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

  try {
    const customer = await stripe.customers.create({
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
    });

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

  const existingClient = await findClientByStripeCustomerId(stripeCustomer.id);

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

  if (existingClient) {
    // Update existing client
    const [updated] = await db
      .update(clients)
      .set(clientData)
      .where(eq(clients.id, existingClient.id))
      .returning();
    return updated?.id ?? null;
  } else {
    // Create new client
    const [created] = await db.insert(clients).values(clientData).returning();
    return created?.id ?? null;
  }
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

  const updateData: Record<string, unknown> = { status: localStatus };
  if (localStatus === "paid") {
    updateData.paidAt = paidAt ?? new Date();
  }

  await db.update(invoices).set(updateData).where(eq(invoices.id, existingInvoice.id));
  return true;
}
