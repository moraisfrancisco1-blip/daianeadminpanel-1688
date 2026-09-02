import { Hono } from "hono";
import Stripe from "stripe";
import { stripe } from "../services/stripe";
import { syncStripeCustomerToLocal, findClientByStripeCustomerId, syncStripeInvoiceStatus, findInvoiceByStripeInvoiceId } from "../services/stripe-sync";
import { db } from "../database";
import { clients, invoices, bookings, services, invoiceItems, payments, refunds } from "../database/schema";
import { eq } from "drizzle-orm";
import { nextNumber } from "../lib/counters";
import { computeVat, DEFAULT_VAT_RATE } from "../lib/totals";
import { buildBookingConfirmationHtml, buildAdminNewBookingHtml } from "../lib/email-templates";
import { sendTrackedEmail } from "../services/email-log";
import { changeInvoiceStatus, recordInvoiceActivity } from "../services/invoice-activity";
import { COMPANY } from "../lib/company";
import { createCalendarEvent } from "../services/google-calendar";
import { sendAdminWhatsApp, buildBookingWhatsAppMessage } from "../services/whatsapp";
import { claimWebhookEvent, markWebhookEventProcessed, markWebhookEventFailed } from "../services/webhook-idempotency";

export const stripeWebhookRoute = new Hono();

// Idempotent payment recording — the unique stripe_payment_intent_id prevents duplicates.
async function recordStripePayment(paymentIntentId: string, invoiceId: number, amount: number, paidAt: Date): Promise<boolean> {
  const [existing] = await db.select().from(payments).where(eq(payments.stripePaymentIntentId, paymentIntentId));
  if (existing) return false;
  await db
    .insert(payments)
    .values({ invoiceId, amount, method: "stripe", paidAt, stripePaymentIntentId: paymentIntentId })
    .onConflictDoNothing();
  return true;
}

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
        const invoiceId = invoice.id;

        // Stripe removed the direct `payment_intent` field from Invoice (API
        // versions 2025-03-31+); the PaymentIntent now lives on the invoice's
        // payment records instead. Look it up explicitly rather than reading
        // a field that no longer exists (which silently resolved to
        // `undefined` and skipped payment recording below).
        let paymentIntentId: string | null = null;
        if (invoiceId) {
          const invoicePayments = await stripe.invoicePayments.list({ invoice: invoiceId });
          const paidPayment = invoicePayments.data.find((p) => p.status === "paid");
          const pi = paidPayment?.payment.payment_intent;
          paymentIntentId = pi ? (typeof pi === "string" ? pi : pi.id) : null;
        }

        const amountPaid = invoice.amount_paid ?? 0;
        const paidAt = invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : new Date();

        console.log("[stripe-webhook] Invoice paid:", invoiceId, "pi:", paymentIntentId);

        // Update the invoice status (idempotent — finds by stripeInvoiceId).
        await syncStripeInvoiceStatus(invoiceId, "paid", paidAt);

        // Record the payment (idempotent — unique stripe_payment_intent_id, NULLs allowed).
        if (paymentIntentId) {
          const localInvoice = await findInvoiceByStripeInvoiceId(invoiceId);
          if (localInvoice) {
            await db
              .insert(payments)
              .values({
                invoiceId: localInvoice.id,
                amount: Number((amountPaid / 100).toFixed(2)),
                method: "stripe",
                paidAt,
                stripePaymentIntentId: paymentIntentId,
              })
              .onConflictDoNothing();
          }
        }
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

      // ==================== REFUND EVENTS ====================

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
        console.log("[stripe-webhook] Charge refunded:", charge.id, "pi:", paymentIntentId, "amount_refunded:", charge.amount_refunded);

        if (!paymentIntentId) break;
        const [localPayment] = await db.select().from(payments).where(eq(payments.stripePaymentIntentId, paymentIntentId));
        if (!localPayment) {
          console.log("[stripe-webhook] No local payment for refunded charge, skipping:", charge.id);
          break;
        }

        // One row per Stripe Refund object — re-delivery of this event (e.g. a
        // second partial refund on the same charge) upserts by stripeRefundId,
        // so nothing is double-counted.
        for (const r of charge.refunds?.data ?? []) {
          const amount = Number((r.amount / 100).toFixed(2));
          await db
            .insert(refunds)
            .values({
              paymentId: localPayment.id,
              invoiceId: localPayment.invoiceId,
              amount,
              reason: r.reason ?? null,
              status: r.status ?? "succeeded",
              stripeRefundId: r.id,
            })
            .onConflictDoUpdate({
              target: refunds.stripeRefundId,
              set: { status: r.status ?? "succeeded", amount },
            });
        }

        await recordInvoiceActivity({
          invoiceId: localPayment.invoiceId,
          type: "refunded",
          channel: "stripe",
          amount: Number((charge.amount_refunded / 100).toFixed(2)),
          method: "stripe",
          metadata: { chargeId: charge.id, paymentIntentId },
        });
        break;
      }

      // ==================== PAYMENT INTENT (in-person / Terminal / direct) ====================

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.log("[stripe-webhook] PaymentIntent succeeded:", pi.id);

        if (pi.status !== "succeeded") break;

        const amount = Number((pi.amount / 100).toFixed(2));

        // Idempotency guard (unique stripe_payment_intent_id).
        const [existingPayment] = await db.select().from(payments).where(eq(payments.stripePaymentIntentId, pi.id));
        if (existingPayment) {
          console.log("[stripe-webhook] Payment already recorded:", pi.id);
          break;
        }

        // 1. Admin invoice via metadata (checkout flow) — the source of truth.
        const adminInvoiceId = pi.metadata?.adminInvoiceId ? Number(pi.metadata.adminInvoiceId) : null;
        let invoiceId: number | null = adminInvoiceId;
        if (invoiceId) {
          const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
          invoiceId = inv?.id ?? null;
        }

        // 2. Reuse an invoice already linked to this PaymentIntent.
        if (!invoiceId) {
          const [inv] = await db.select().from(invoices).where(eq(invoices.stripePaymentIntentId, pi.id));
          invoiceId = inv?.id ?? null;
        }

        if (invoiceId) {
          const created = await recordStripePayment(pi.id, invoiceId, amount, new Date(pi.created * 1000));
          await changeInvoiceStatus(invoiceId, "paid", {
            channel: "stripe",
            type: "paid",
            paidAt: new Date(pi.created * 1000),
            metadata: { paymentIntentId: pi.id },
          });
          await db
            .update(invoices)
            .set({ stripePaymentIntentStatus: "succeeded", lastStripeVerifiedAt: new Date() })
            .where(eq(invoices.id, invoiceId));
          if (created) {
            await recordInvoiceActivity({
              invoiceId,
              type: "payment_confirmed",
              channel: "stripe",
              amount,
              method: "stripe",
              metadata: { paymentIntentId: pi.id },
            });
          }
          break;
        }

        // 3. Unlinked (Terminal / direct) payment — identify client and create an Admin invoice.
        const customerId = typeof pi.customer === "string" ? pi.customer : (pi.customer as { id?: string } | null)?.id ?? null;
        let clientId: number | null = null;
        if (customerId) {
          const client = await findClientByStripeCustomerId(customerId);
          if (client) clientId = client.id;
        }
        if (!clientId) {
          console.log("[stripe-webhook] No local client for PaymentIntent, skipping:", pi.id, "customer:", customerId);
          break;
        }

        const vatRate = DEFAULT_VAT_RATE;
        const { net, vat } = computeVat(amount, vatRate);
        const invoiceNumber = await nextNumber("invoice", new Date().getFullYear());
        const issueDate = new Date();
        const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

        const [invoice] = await db
          .insert(invoices)
          .values({
            invoiceNumber,
            clientId,
            status: "paid",
            issueDate,
            dueDate,
            subtotal: net,
            vatTotal: vat,
            total: amount,
            paidAt: new Date(pi.created * 1000),
            stripePaymentIntentId: pi.id,
          })
          .returning();

        await db.insert(invoiceItems).values({
          invoiceId: invoice!.id,
          description: pi.description ?? "Stripe payment",
          quantity: 1,
          unitPrice: net,
          vatRate,
          amount: net,
        });

        await recordInvoiceActivity({ invoiceId: invoice!.id, type: "created", newStatus: "paid", channel: "stripe", amount, metadata: { paymentIntentId: pi.id } });
        await recordStripePayment(pi.id, invoice!.id, amount, new Date(pi.created * 1000));
        await recordInvoiceActivity({ invoiceId: invoice!.id, type: "payment_confirmed", channel: "stripe", amount, method: "stripe", metadata: { paymentIntentId: pi.id } });
        break;
      }

      // ==================== CHECKOUT / BOOKING EVENT ====================

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("[stripe-webhook] Checkout session completed:", session.id);

        const amountPaid = Number(((session.amount_total ?? 0) / 100).toFixed(2));
        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent as { id?: string } | null)?.id ?? null;
        const adminInvoiceId = session.metadata?.adminInvoiceId ? Number(session.metadata.adminInvoiceId) : null;
        const bookingId = session.metadata?.bookingId ? Number(session.metadata.bookingId) : null;

        // Idempotency: claim with a persistent state machine (processing -> processed/failed).
        // A failed attempt is retried on the next Stripe delivery; a successful one is never re-run.
        const claim = await claimWebhookEvent(event.id, event.type);
        if (claim === "skip") {
          console.log("[stripe-webhook] Duplicate checkout event, skipping:", event.id);
          break;
        }
        processingEventId = event.id;

        // === A. Admin invoice checkout (the Admin invoice is the source of truth) ===
        if (adminInvoiceId) {
          const [invoice] = await db.select().from(invoices).where(eq(invoices.id, adminInvoiceId));
          if (invoice) {
            await db
              .update(invoices)
              .set({
                stripePaymentIntentId: paymentIntentId ?? invoice.stripePaymentIntentId,
                stripeCheckoutSessionId: session.id,
                stripeCheckoutStatus: "complete",
                stripePaymentIntentStatus: "succeeded",
                lastStripeVerifiedAt: new Date(),
              })
              .where(eq(invoices.id, invoice.id));
            await changeInvoiceStatus(invoice.id, "paid", {
              channel: "stripe",
              type: "paid",
              paidAt: new Date(),
              metadata: { paymentIntentId, checkoutSessionId: session.id, invoiceNumber: invoice.invoiceNumber },
            });
            if (paymentIntentId) {
              const created = await recordStripePayment(paymentIntentId, invoice.id, amountPaid, new Date());
              if (created) {
                await recordInvoiceActivity({
                  invoiceId: invoice.id,
                  type: "payment_confirmed",
                  channel: "stripe",
                  amount: amountPaid,
                  method: "stripe",
                  metadata: { paymentIntentId, checkoutSessionId: session.id },
                });
              }
            }
            if (bookingId) {
              await db.update(bookings).set({ invoiceId: invoice.id, status: "confirmed", depositStatus: "paid" }).where(eq(bookings.id, bookingId));
            }
            await markWebhookEventProcessed(event.id);
            processingEventId = null;
            break;
          }
          console.log("[stripe-webhook] Admin invoice not found for checkout:", adminInvoiceId);
        }

        // === B. Booking checkout (existing flow) ===
        if (!bookingId) {
          console.log("[stripe-webhook] No bookingId/adminInvoiceId in session metadata, skipping");
          break;
        }

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

        // Reuse an existing invoice for this booking (no duplicates).
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
        await db.update(bookings).set({ clientId: client!.id }).where(eq(bookings.id, bookingId));

        // Create the Admin invoice (source of truth) for the booking deposit.
        const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
        const vatRate = service?.vatRate ?? DEFAULT_VAT_RATE;
        const amount = booking.depositAmount;
        const { net, vat } = computeVat(amount, vatRate);
        const invoiceNumber = await nextNumber("invoice", new Date().getFullYear());
        const issueDate = new Date();
        const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

        const [invoice] = await db.insert(invoices).values({
          invoiceNumber,
          clientId: client!.id,
          bookingId: booking.id,
          status: "paid",
          issueDate,
          dueDate,
          notes: booking.payFullNow ? "Paid in full at booking." : "Booking deposit — remainder due at session.",
          subtotal: net,
          vatTotal: vat,
          total: amount,
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntentId,
          stripeCheckoutSessionId: session.id,
        }).returning();

        await db.insert(invoiceItems).values({
          invoiceId: invoice!.id,
          description: booking.payFullNow ? `${service?.name ?? "Session"} — full payment` : `${service?.name ?? "Session"} — booking deposit`,
          quantity: 1,
          unitPrice: net,
          vatRate,
          amount: net,
        });

        // Link the invoice to the booking (also powers idempotency on retries).
        await db.update(bookings).set({ invoiceId: invoice!.id }).where(eq(bookings.id, bookingId));

        await recordInvoiceActivity({ invoiceId: invoice!.id, type: "created", newStatus: "paid", channel: "stripe", amount, metadata: { paymentIntentId } });

        // Record the payment (idempotent — never duplicates).
        if (paymentIntentId) {
          const created = await recordStripePayment(paymentIntentId, invoice!.id, amount, new Date());
          if (created) {
            await recordInvoiceActivity({ invoiceId: invoice!.id, type: "payment_confirmed", channel: "stripe", amount, method: "stripe", metadata: { paymentIntentId } });
          }
        }

        // Send confirmation emails
        await sendTrackedEmail({
          to: booking.email,
          recipientName: booking.name,
          bookingId: booking.id,
          clientId: client!.id,
          invoiceId: invoice!.id,
          type: "booking_confirmation",
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

        await sendTrackedEmail({
          to: COMPANY.adminEmail,
          recipientName: booking.name,
          bookingId: booking.id,
          clientId: client!.id,
          invoiceId: invoice!.id,
          type: "other",
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

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("[stripe-webhook] Checkout session expired:", session.id);
        const [expiredInvoice] = await db
          .select()
          .from(invoices)
          .where(eq(invoices.stripeCheckoutSessionId, session.id));
        if (expiredInvoice && expiredInvoice.status !== "paid") {
          await db
            .update(invoices)
            .set({ stripeCheckoutStatus: "expired", lastStripeVerifiedAt: new Date() })
            .where(eq(invoices.id, expiredInvoice.id));
        }
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