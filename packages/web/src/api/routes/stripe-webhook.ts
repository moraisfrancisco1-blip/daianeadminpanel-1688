import { Hono } from "hono";
import Stripe from "stripe";
import { stripe } from "../services/stripe";
import { syncStripeCustomerToLocal, findClientByStripeCustomerId, syncStripeInvoiceStatus, findInvoiceByStripeInvoiceId } from "../services/stripe-sync";
import { db } from "../database";
import { clients, invoices } from "../database/schema";
import { eq } from "drizzle-orm";

export const stripeWebhookRoute = new Hono();

// Raw body parser for Stripe webhook signature verification
stripeWebhookRoute.post("/", async (c) => {
  if (!stripe) {
    return c.json({ message: "Stripe not configured" }, 400);
  }

  const signature = c.req.header("stripe-signature");
  if (!signature) {
    return c.json({ message: "Missing stripe-signature header" }, 400);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ message: "STRIPE_WEBHOOK_SECRET not configured" }, 400);
  }

  const body = await c.req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return c.json({ message: "Invalid signature" }, 400);
  }

  console.log("[stripe-webhook] Received event:", event.type);

  try {
    switch (event.type) {
      case "customer.created": {
        const customer = event.data.object as Stripe.Customer;
        console.log("[stripe-webhook] Customer created:", customer.id);
        await syncStripeCustomerToLocal({
          id: customer.id,
          name: customer.name ?? null,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          address: customer.address
            ? {
                line1: customer.address.line1 ?? null,
                city: customer.address.city ?? null,
                country: customer.address.country ?? null,
                postal_code: customer.address.postal_code ?? null,
              }
            : null,
        });
        break;
      }

      case "customer.updated": {
        const customer = event.data.object as Stripe.Customer;
        console.log("[stripe-webhook] Customer updated:", customer.id);
        await syncStripeCustomerToLocal({
          id: customer.id,
          name: customer.name ?? null,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          address: customer.address
            ? {
                line1: customer.address.line1 ?? null,
                city: customer.address.city ?? null,
                country: customer.address.country ?? null,
                postal_code: customer.address.postal_code ?? null,
              }
            : null,
        });
        break;
      }

      case "customer.deleted": {
        const customer = event.data.object as Stripe.Customer;
        console.log("[stripe-webhook] Customer deleted:", customer.id);
        const localClient = await findClientByStripeCustomerId(customer.id);
        if (localClient) {
          // Remove stripeCustomerId from local client but keep the client record
          await db
            .update(clients)
            .set({ stripeCustomerId: null })
            .where(eq(clients.id, localClient.id));
        }
        break;
      }

      // ==================== INVOICE EVENTS ====================

      case "invoice.created": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[stripe-webhook] Invoice created:", invoice.id);
        // Invoice creation is handled by the admin panel, no action needed
        break;
      }

      case "invoice.updated": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceData = invoice as unknown as { id: string; status?: string; paid_at?: number };
        console.log("[stripe-webhook] Invoice updated:", invoiceData.id);
        // Sync invoice status from Stripe to local database
        await syncStripeInvoiceStatus(
          invoiceData.id,
          invoiceData.status ?? "draft",
          invoiceData.status === "paid" && invoiceData.paid_at ? new Date(invoiceData.paid_at * 1000) : null
        );
        break;
      }

      case "invoice.finalized": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceData = invoice as unknown as { id: string };
        console.log("[stripe-webhook] Invoice finalized:", invoiceData.id);
        await syncStripeInvoiceStatus(invoiceData.id, "sent", null);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceData = invoice as unknown as { id: string; paid_at?: number };
        console.log("[stripe-webhook] Invoice paid:", invoiceData.id);
        await syncStripeInvoiceStatus(
          invoiceData.id,
          "paid",
          invoiceData.paid_at ? new Date(invoiceData.paid_at * 1000) : new Date()
        );
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[stripe-webhook] Invoice payment failed:", invoice.id);
        // Keep status as "sent" but log the failure
        break;
      }

      case "invoice.voided": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[stripe-webhook] Invoice voided:", invoice.id);
        await syncStripeInvoiceStatus(invoice.id, "cancelled", null);
        break;
      }

      case "invoice.deleted": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[stripe-webhook] Invoice deleted:", invoice.id);
        const localInvoice = await findInvoiceByStripeInvoiceId(invoice.id);
        if (localInvoice) {
          // Remove stripeInvoiceId from local invoice but keep the record
          await db
            .update(invoices)
            .set({ stripeInvoiceId: null, stripePaymentIntentId: null })
            .where(eq(invoices.id, localInvoice.id));
        }
        break;
      }

      default:
        console.log("[stripe-webhook] Unhandled event type:", event.type);
    }
  } catch (error) {
    console.error("[stripe-webhook] Error processing event:", error);
    return c.json({ message: "Error processing event" }, 500);
  }

  return c.json({ received: true }, 200);
});