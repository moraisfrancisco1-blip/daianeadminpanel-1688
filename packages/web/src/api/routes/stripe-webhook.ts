import { Hono } from "hono";
import Stripe from "stripe";
import { stripe } from "../services/stripe";
import { syncStripeCustomerToLocal, findClientByStripeCustomerId, syncStripeInvoiceStatus, findInvoiceByStripeInvoiceId } from "../services/stripe-sync";
import { db } from "../database";
import { clients, invoices, bookings, services, invoiceItems } from "../database/schema";
import { eq } from "drizzle-orm";
import { nextNumber } from "../lib/counters";
import { buildBookingConfirmationHtml, buildAdminNewBookingHtml } from "../lib/email-templates";
import { sendEmail } from "../services/email";
import { COMPANY } from "../lib/company";
import { createCalendarEvent } from "../services/google-calendar";
import { sendAdminWhatsApp, buildBookingWhatsAppMessage } from "../services/whatsapp";
import { claimWebhookEvent, markWebhookEventProcessed, markWebhookEventFailed } from "../services/webhook-idempotency";

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
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return c.json({ message: "Invalid signature" }, 400);
  }

  console.log("[stripe-webhook] Received event:", event.type);

  let processingEventId: string | null = null;

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
        break;
      }

      case "invoice.updated": {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceData = invoice as unknown as { id: string; status?: string; paid_at?: number };
        console.log("[stripe-webhook] Invoice updated:", invoiceData.id);
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
          await db
            .update(invoices)
            .set({ stripeInvoiceId: null, stripePaymentIntentId: null })
            .where(eq(invoices.id, localInvoice.id));
        }
        break;
      }

      // ==================== CHECKOUT / BOOKING EVENT ====================

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("[stripe-webhook] Checkout session completed:", session.id);

        const bookingId = session.metadata?.bookingId ? Number(session.metadata.bookingId) : null;
        if (!bookingId) {
          console.log("[stripe-webhook] No bookingId in session metadata, skipping");
          break;
        }

        // Idempotency: claim with a persistent state machine (processing -> processed/failed).
        // A failed attempt is retried on the next Stripe delivery; a successful one is never re-run.
        const claim = await claimWebhookEvent(event.id, event.type);
        if (claim === "skip") {
          console.log("[stripe-webhook] Duplicate checkout event, skipping:", event.id);
          break;
        }
        processingEventId = event.id;

        const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
        if (!booking) {
          console.log("[stripe-webhook] Booking not found:", bookingId);
          await markWebhookEventProcessed(event.id);
          processingEventId = null;
          break;
        }

        // Ensure the booking is confirmed/paid (idempotent).
        if (booking.status !== "confirmed" || booking.depositStatus !== "paid") {
          await db.update(bookings).set({ status: "confirmed", depositStatus: "paid" }).where(eq(bookings.id, bookingId));
        }

        // Only create the invoice (and send notifications) once. On a retry after a
        // partial failure, or a different event for the same booking, an invoice already
        // exists so this block is skipped — no duplicates.
        const [existingInvoice] = await db.select().from(invoices).where(eq(invoices.bookingId, bookingId));
        if (existingInvoice) {
          if (booking.invoiceId == null) {
            await db.update(bookings).set({ invoiceId: existingInvoice.id }).where(eq(bookings.id, bookingId));
          }
          await markWebhookEventProcessed(event.id);
          processingEventId = null;
          break;
        }

        // Find or create client
        let [client] = await db.select().from(clients).where(eq(clients.email, booking.email));
        if (!client) {
          [client] = await db.insert(clients).values({ name: booking.name, email: booking.email, phone: booking.phone }).returning();
        }

        // Update booking with clientId
        await db.update(bookings).set({ clientId: client!.id }).where(eq(bookings.id, bookingId));

        // Create invoice
        const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
        const invoiceNumber = await nextNumber("invoice", new Date().getFullYear());
        const issueDate = new Date();
        const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);
        const amount = booking.depositAmount;
        const vatRate = service?.vatRate ?? 0.09;
        const base = Number((amount / (1 + vatRate)).toFixed(2));
        const vat = Number((amount - base).toFixed(2));

        const [invoice] = await db.insert(invoices).values({
          invoiceNumber,
          clientId: client!.id,
          bookingId: booking.id,
          status: "paid",
          issueDate,
          dueDate,
          notes: booking.payFullNow ? "Paid in full at booking." : "Booking deposit — remainder due at session.",
          subtotal: base,
          vatTotal: vat,
          total: amount,
          paidAt: new Date(),
        }).returning();

        await db.insert(invoiceItems).values({
          invoiceId: invoice!.id,
          description: booking.payFullNow ? `${service?.name ?? "Session"} — full payment` : `${service?.name ?? "Session"} — booking deposit`,
          quantity: 1,
          unitPrice: amount,
          vatRate,
          amount,
        });

        // Link the invoice to the booking (also powers idempotency on retries).
        await db.update(bookings).set({ invoiceId: invoice!.id }).where(eq(bookings.id, bookingId));

        // Send confirmation emails
        await sendEmail({
          to: booking.email,
          subject: "Booking confirmed — Studio Daï Oakes",
          html: buildBookingConfirmationHtml({
            name: booking.name,
            serviceName: service?.name ?? "Session",
            date: booking.date,
            startTime: booking.startTime,
            durationMinutes: service?.durationMinutes ?? 60,
            depositAmount: booking.depositAmount,
            depositStatus: "paid",
            paymentMethod: booking.paymentMethod,
            payFullNow: booking.payFullNow,
            servicePrice: service?.price ?? 0,
          }),
        });

        await sendEmail({
          to: COMPANY.adminEmail,
          subject: `New booking — ${booking.name} (${service?.name ?? "Session"})`,
          html: buildAdminNewBookingHtml({
            clientName: booking.name,
            clientEmail: booking.email,
            clientPhone: booking.phone,
            serviceName: service?.name ?? "Session",
            date: booking.date,
            startTime: booking.startTime,
            amount: booking.depositAmount,
            payFullNow: booking.payFullNow,
          }),
        });

        // Sync to Google Calendar
        try {
          const eventId = await createCalendarEvent({
            bookingId: booking.id,
            summary: `${service?.name ?? "Session"} — ${booking.name}`,
            description: `Nome: ${booking.name}\nServiço: ${service?.name ?? "Session"}\nTelefone: ${booking.phone ?? "—"}`,
            date: booking.date,
            startTime: booking.startTime,
            durationMinutes: service?.durationMinutes ?? 60,
            attendeeEmail: booking.email,
          });
          if (eventId) {
            await db.update(bookings).set({ googleEventId: eventId }).where(eq(bookings.id, bookingId));
          }
        } catch (err) {
          console.error("[stripe-webhook] Failed to sync booking to Google Calendar", err);
        }

        // WhatsApp notification
        await sendAdminWhatsApp(
          buildBookingWhatsAppMessage({
            clientName: booking.name,
            clientPhone: booking.phone,
            serviceName: service?.name ?? "Session",
            date: booking.date,
            startTime: booking.startTime,
            amount: booking.depositAmount,
            payFullNow: booking.payFullNow,
          }),
        );

        await markWebhookEventProcessed(event.id);
        processingEventId = null;

        break;
      }

      default:
        console.log("[stripe-webhook] Unhandled event type:", event.type);
    }
  } catch (error) {
    console.error("[stripe-webhook] Error processing event:", error);
    if (processingEventId) {
      await markWebhookEventFailed(processingEventId, error instanceof Error ? error.message : String(error));
    }
    return c.json({ message: "Error processing event" }, 500);
  }

  return c.json({ received: true }, 200);
});