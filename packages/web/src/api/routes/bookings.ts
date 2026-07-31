import { Hono } from "hono";
import { db } from "../database";
import { bookings, services, clients, invoices, invoiceItems } from "../database/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { stripe } from "../services/stripe";
import { sendEmail } from "../services/email";
import { buildBookingConfirmationHtml, buildAdminNewBookingHtml, buildRemainderPaymentEmailHtml } from "../lib/email-templates";
import { nextNumber } from "../lib/counters";
import { COMPANY } from "../lib/company";
import { createCalendarEvent, getGoogleBusyIntervals, deleteCalendarEvent, updateCalendarEvent } from "../services/google-calendar";
import { sendAdminWhatsApp, buildBookingWhatsAppMessage } from "../services/whatsapp";

const WORK_DAYS = [1, 3, 5]; // Mon, Wed, Fri
const WORK_START_MIN = 10 * 60; // 10:00
const WORK_END_MIN = 18 * 60; // 18:00 — last session must END by this time
const BUFFER_MIN = 15; // gap required between sessions
const SLOT_GRANULARITY_MIN = 15;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + (m ?? 0);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export const bookingsRoute = new Hono()
  // Public: list available slots for a given date
  .get("/availability", async (c) => {
    const date = c.req.query("date");
    if (!date) return c.json({ message: "date required (YYYY-MM-DD)" }, 400);
    const d = new Date(date + "T00:00:00");
    const day = d.getDay();
    if (!WORK_DAYS.includes(day)) return c.json({ slots: [] }, 200);

    const [service] = c.req.query("serviceId")
      ? await db.select().from(services).where(eq(services.id, Number(c.req.query("serviceId"))))
      : [null];
    const duration = service?.durationMinutes ?? 60;

    const existing = await db.select().from(bookings).where(
      and(eq(bookings.date, date), eq(bookings.status, "confirmed")),
    );
    const pending = await db.select().from(bookings).where(
      and(eq(bookings.date, date), eq(bookings.status, "pending_deposit")),
    );

    // Look up durations for existing bookings to build accurate busy intervals.
    const allServices = await db.select().from(services);
    const serviceDuration = new Map(allServices.map((s) => [s.id, s.durationMinutes]));

    // Each existing booking blocks [start - buffer, start + duration + buffer)
    // so every session keeps at least a 15 min gap on both sides.
    const busyIntervals = [...existing, ...pending].map((b) => {
      const start = timeToMinutes(b.startTime);
      const dur = serviceDuration.get(b.serviceId) ?? 60;
      return { start: start - BUFFER_MIN, end: start + dur + BUFFER_MIN };
    });

    // Also block out any events already on Daiane's Google Calendar for this date,
    // so the public site never offers a slot she's already busy with elsewhere.
    try {
      const googleBusy = await getGoogleBusyIntervals(date);
      for (const b of googleBusy) {
        busyIntervals.push({ start: b.start - BUFFER_MIN, end: b.end + BUFFER_MIN });
      }
    } catch (err) {
      console.error("[bookings] failed to read Google Calendar availability", err);
    }

    const slots: string[] = [];
    for (let start = WORK_START_MIN; start + duration <= WORK_END_MIN; start += SLOT_GRANULARITY_MIN) {
      const end = start + duration;
      const overlaps = busyIntervals.some((b) => start < b.end && end > b.start);
      if (!overlaps) slots.push(minutesToTime(start));
    }
    return c.json({ slots }, 200);
  })
  // Public: create a booking (pending deposit) + Stripe checkout session
  .post("/", async (c) => {
    const body = await c.req.json();
    const [service] = await db.select().from(services).where(eq(services.id, body.serviceId));
    if (!service) return c.json({ message: "Invalid service" }, 400);

    const payFullNow = !!body.payFullNow;
    const amountToCharge = payFullNow ? service.price : 25;

    // Free services (e.g. "Coffee & Talk") need no payment — confirm immediately.
    if (service.price === 0) {
      const [booking] = await db
        .insert(bookings)
        .values({
          name: body.name,
          email: body.email,
          phone: body.phone ?? null,
          serviceId: body.serviceId,
          date: body.date,
          startTime: body.startTime,
          status: "confirmed",
          depositAmount: 0,
          depositStatus: "paid",
          payFullNow: true,
          paymentMethod: null,
        })
        .returning();

      let [client] = await db.select().from(clients).where(eq(clients.email, booking!.email));
      if (!client) {
        [client] = await db
          .insert(clients)
          .values({ name: booking!.name, email: booking!.email, phone: booking!.phone })
          .returning();
      }

      await sendEmail({
        to: booking!.email,
        subject: "Booking confirmed — Studio Daï Oakes",
        html: buildBookingConfirmationHtml({
          name: booking!.name,
          serviceName: service.name,
          date: booking!.date,
          startTime: booking!.startTime,
          durationMinutes: service.durationMinutes,
          depositAmount: 0,
          depositStatus: "paid",
          paymentMethod: null,
          payFullNow: true,
          servicePrice: service.price,
        }),
      });

      await sendEmail({
        to: COMPANY.adminEmail,
        subject: `New booking — ${booking!.name} (${service.name})`,
        html: buildAdminNewBookingHtml({
          clientName: booking!.name,
          clientEmail: booking!.email,
          clientPhone: booking!.phone,
          serviceName: service.name,
          date: booking!.date,
          startTime: booking!.startTime,
          amount: 0,
          payFullNow: true,
        }),
      });

      await syncBookingToGoogleCalendar(booking!, service.name, service.durationMinutes);

      await sendAdminWhatsApp(
        buildBookingWhatsAppMessage({
          clientName: booking!.name,
          clientPhone: booking!.phone,
          serviceName: service.name,
          date: booking!.date,
          startTime: booking!.startTime,
          amount: 0,
          payFullNow: true,
        }),
      );

      return c.json({ booking, checkoutUrl: null, free: true }, 201);
    }

    const [booking] = await db
      .insert(bookings)
      .values({
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        serviceId: body.serviceId,
        date: body.date,
        startTime: body.startTime,
        status: "pending_deposit",
        depositAmount: payFullNow ? service.price : 25,
        depositStatus: "unpaid",
        payFullNow,
        paymentMethod: body.paymentMethod ?? null,
      })
      .returning();

    if (!stripe) {
      // No online payment configured (cash-based practice): confirm the booking
      // immediately, put it on the calendar and send the confirmation emails —
      // otherwise it would stay stuck in "pending_deposit" forever and never sync.
      await db
        .update(bookings)
        .set({ status: "confirmed", depositStatus: "unpaid" })
        .where(eq(bookings.id, booking!.id));

      let [client] = await db.select().from(clients).where(eq(clients.email, booking!.email));
      if (!client) {
        [client] = await db
          .insert(clients)
          .values({ name: booking!.name, email: booking!.email, phone: booking!.phone })
          .returning();
      }

      await sendEmail({
        to: booking!.email,
        subject: "Booking confirmed — Studio Daï Oakes",
        html: buildBookingConfirmationHtml({
          name: booking!.name,
          serviceName: service.name,
          date: booking!.date,
          startTime: booking!.startTime,
          durationMinutes: service.durationMinutes,
          depositAmount: amountToCharge,
          depositStatus: "unpaid",
          paymentMethod: body.paymentMethod ?? null,
          payFullNow,
          servicePrice: service.price,
        }),
      });

      await sendEmail({
        to: COMPANY.adminEmail,
        subject: `New booking — ${booking!.name} (${service.name})`,
        html: buildAdminNewBookingHtml({
          clientName: booking!.name,
          clientEmail: booking!.email,
          clientPhone: booking!.phone,
          serviceName: service.name,
          date: booking!.date,
          startTime: booking!.startTime,
          amount: amountToCharge,
          payFullNow,
        }),
      });

      await syncBookingToGoogleCalendar(
        { ...booking! },
        service.name,
        service.durationMinutes,
      );

      return c.json({ booking, checkoutUrl: null, message: "Confirmed (no online payment)" }, 201);
    }

    const origin = c.req.header("origin") ?? process.env.WEBSITE_URL ?? "";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // No payment_method_types specified — Stripe Checkout automatically shows
      // every payment method enabled in the Dashboard (card, iDEAL, etc.).
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: payFullNow ? `${service.name} — Full payment` : `Booking deposit — ${service.name}`,
            },
            unit_amount: Math.round(amountToCharge * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/book/confirmed?booking=${booking!.id}`,
      cancel_url: `${origin}/book?cancelled=1`,
      metadata: { bookingId: String(booking!.id) },
    });

    await db
      .update(bookings)
      .set({ stripeCheckoutSessionId: session.id })
      .where(eq(bookings.id, booking!.id));

    return c.json({ booking, checkoutUrl: session.url }, 201);
  })
  .get("/", requireAuth, async (c) => {
    const all = await db
      .select({
        id: bookings.id,
        name: bookings.name,
        email: bookings.email,
        phone: bookings.phone,
        serviceId: bookings.serviceId,
        serviceName: services.name,
        date: bookings.date,
        startTime: bookings.startTime,
        status: bookings.status,
        depositAmount: bookings.depositAmount,
        depositStatus: bookings.depositStatus,
        payFullNow: bookings.payFullNow,
        invoiceId: bookings.invoiceId,
      })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .orderBy(desc(bookings.createdAt));
    return c.json({ bookings: all }, 200);
  })
  // Admin: create a manual booking (confirmed immediately, no payment required)
  .post("/manual", requireAuth, async (c) => {
    const body = await c.req.json();
    const [service] = await db.select().from(services).where(eq(services.id, body.serviceId));
    if (!service) return c.json({ message: "Invalid service" }, 400);

    // Find or create client
    let [client] = await db.select().from(clients).where(eq(clients.email, body.email));
    if (!client) {
      [client] = await db
        .insert(clients)
        .values({ name: body.name, email: body.email, phone: body.phone ?? null })
        .returning();
    }

    const [booking] = await db
      .insert(bookings)
      .values({
        clientId: client!.id,
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        serviceId: body.serviceId,
        date: body.date,
        startTime: body.startTime,
        status: "confirmed",
        depositAmount: body.depositAmount ?? 0,
        depositStatus: body.depositAmount ? "unpaid" : "paid",
        payFullNow: true,
        paymentMethod: body.paymentMethod ?? null,
        notes: body.notes ?? null,
      })
      .returning();

    // Determine if this is truly a full payment or just a deposit
    const isFullPayment = booking!.depositAmount >= service.price;

    // If deposit is unpaid, create a Stripe checkout session for the deposit
    let checkoutUrl: string | null = null;
    if (booking!.depositStatus === "unpaid" && booking!.depositAmount > 0 && stripe) {
      try {
        const origin = c.req.header("origin") ?? process.env.WEBSITE_URL ?? "";
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "eur",
                product_data: {
                  name: `${service.name} — booking deposit`,
                },
                unit_amount: Math.round(booking!.depositAmount * 100),
              },
              quantity: 1,
            },
          ],
          success_url: `${origin}/book/confirmed?booking=${booking!.id}`,
          cancel_url: `${origin}/bookings`,
          metadata: { bookingId: String(booking!.id) },
        });
        checkoutUrl = session.url;
        await db
          .update(bookings)
          .set({ stripeCheckoutSessionId: session.id })
          .where(eq(bookings.id, booking!.id));
      } catch (err) {
        console.error("[bookings/manual] failed to create Stripe checkout for deposit", err);
      }
    }

    // Send confirmation emails
    await sendEmail({
      to: booking!.email,
      subject: "Booking confirmed — Studio Daï Oakes",
      html: buildBookingConfirmationHtml({
        name: booking!.name,
        serviceName: service.name,
        date: booking!.date,
        startTime: booking!.startTime,
        durationMinutes: service.durationMinutes,
        depositAmount: booking!.depositAmount,
        depositStatus: booking!.depositStatus,
        paymentMethod: booking!.paymentMethod,
        payFullNow: isFullPayment,
        servicePrice: service.price,
        checkoutUrl,
      }),
    });

    await sendEmail({
      to: COMPANY.adminEmail,
      subject: `New booking — ${booking!.name} (${service.name})`,
      html: buildAdminNewBookingHtml({
        clientName: booking!.name,
        clientEmail: booking!.email,
        clientPhone: booking!.phone,
        serviceName: service.name,
        date: booking!.date,
        startTime: booking!.startTime,
        amount: booking!.depositAmount,
        payFullNow: isFullPayment,
      }),
    });

    // Sync to Google Calendar
    await syncBookingToGoogleCalendar(booking!, service.name, service.durationMinutes);

    // Send WhatsApp notification
    await sendAdminWhatsApp(
      buildBookingWhatsAppMessage({
        clientName: booking!.name,
        clientPhone: booking!.phone,
        serviceName: service.name,
        date: booking!.date,
        startTime: booking!.startTime,
        amount: booking!.depositAmount,
        payFullNow: isFullPayment,
      }),
    );

    return c.json({ booking }, 201);
  })
  .put("/:id/status", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const { status } = await c.req.json();
    
    // Get the booking before updating to check for Google Calendar sync
    const [existingBooking] = await db.select().from(bookings).where(eq(bookings.id, id));
    
    const [booking] = await db.update(bookings).set({ status }).where(eq(bookings.id, id)).returning();
    
    // Sync with Google Calendar
    if (existingBooking && booking) {
      const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
      const serviceName = service?.name ?? "Session";
      const durationMinutes = service?.durationMinutes ?? 60;
      
      // If status changed to cancelled, delete the calendar event
      if (status === "cancelled" && existingBooking.googleEventId) {
        await deleteCalendarEvent(existingBooking.googleEventId);
        await db.update(bookings).set({ googleEventId: null }).where(eq(bookings.id, id));
      }
      // If status changed to confirmed and there's no calendar event yet, create one
      else if (status === "confirmed" && !existingBooking.googleEventId && existingBooking.status !== "confirmed") {
        await syncBookingToGoogleCalendar(booking, serviceName, durationMinutes);
      }
    }
    
    return c.json({ booking }, 200);
  })
  // Admin: send remainder payment email (10 min before session ends)
  .post("/:id/send-remainder-email", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    
    // Get booking with service details
    const [booking] = await db
      .select({
        id: bookings.id,
        name: bookings.name,
        email: bookings.email,
        date: bookings.date,
        startTime: bookings.startTime,
        depositAmount: bookings.depositAmount,
        depositStatus: bookings.depositStatus,
        serviceId: bookings.serviceId,
        remainderEmailSentAt: bookings.remainderEmailSentAt,
      })
      .from(bookings)
      .where(eq(bookings.id, id));
    
    if (!booking) return c.json({ message: "Booking not found" }, 404);
    
    // Check if remainder email was already sent
    if (booking.remainderEmailSentAt) {
      return c.json({ message: "Remainder email already sent" }, 400);
    }
    
    // Check if there's actually a remainder to pay
    const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
    if (!service) return c.json({ message: "Service not found" }, 404);
    
    const remainder = service.price - booking.depositAmount;
    if (remainder <= 0) {
      return c.json({ message: "No remainder to pay" }, 400);
    }
    
    // Create Stripe checkout session for remainder
    if (!stripe) {
      return c.json({ message: "Stripe not configured" }, 400);
    }
    
    const origin = c.req.header("origin") ?? process.env.WEBSITE_URL ?? "";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${service.name} — remaining payment`,
            },
            unit_amount: Math.round(remainder * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/book/confirmed?booking=${booking.id}`,
      cancel_url: `${origin}/bookings`,
      metadata: { bookingId: String(booking.id), type: "remainder" },
    });
    
    // Send remainder payment email
    const checkoutUrl = session.url ?? `${origin}/bookings`;
    await sendEmail({
      to: booking.email,
      subject: "Payment reminder — Studio Daï Oakes",
      html: buildRemainderPaymentEmailHtml({
        name: booking.name,
        serviceName: service.name,
        date: booking.date,
        startTime: booking.startTime,
        depositAmount: booking.depositAmount,
        servicePrice: service.price,
        checkoutUrl,
      }),
    });
    
    // Mark email as sent
    await db
      .update(bookings)
      .set({ remainderEmailSentAt: new Date() })
      .where(eq(bookings.id, id));
    
    return c.json({ success: true, checkoutUrl: session.url }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    
    // Get the booking before deleting to check for Google Calendar sync
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, id));
    
    // Delete from Google Calendar if there's an event
    if (booking?.googleEventId) {
      await deleteCalendarEvent(booking.googleEventId);
    }
    
    await db.delete(bookings).where(eq(bookings.id, id));
    return c.json({ success: true }, 200);
  })
  // Stripe webhook — confirms deposit/payment and auto-creates a draft invoice
  .post("/webhook/stripe", async (c) => {
    if (!stripe) return c.json({ message: "Stripe not configured" }, 400);
    const sig = c.req.header("stripe-signature");
    const body = await c.req.text();
    let event;
    try {
      event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err) {
      return c.json({ message: "Invalid signature" }, 400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: { bookingId?: string } };
      const bookingId = Number(session.metadata?.bookingId);
      if (bookingId) {
        const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
        if (booking) {
          await db
            .update(bookings)
            .set({ status: "confirmed", depositStatus: "paid" })
            .where(eq(bookings.id, bookingId));

          // find or create client
          let [client] = await db.select().from(clients).where(eq(clients.email, booking.email));
          if (!client) {
            [client] = await db
              .insert(clients)
              .values({ name: booking.name, email: booking.email, phone: booking.phone })
              .returning();
          }

          const [service] = await db.select().from(services).where(eq(services.id, booking.serviceId));
          const invoiceNumber = await nextNumber("invoice", new Date().getFullYear());
          const issueDate = new Date();
          const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);
          const amount = booking.depositAmount;
          const vatRate = service?.vatRate ?? 0.09;
          const base = Number((amount / (1 + vatRate)).toFixed(2));
          const vat = Number((amount - base).toFixed(2));

          const [invoice] = await db
            .insert(invoices)
            .values({
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
            })
            .returning();

          await db.insert(invoiceItems).values({
            invoiceId: invoice!.id,
            serviceId: service?.id ?? null,
            description: booking.payFullNow
              ? `${service?.name ?? "Session"} — full payment`
              : `${service?.name ?? "Session"} — booking deposit`,
            quantity: 1,
            unitPrice: amount,
            vatRate,
            amount,
          });

          await db.update(bookings).set({ invoiceId: invoice!.id }).where(eq(bookings.id, bookingId));

          const isFullPayment = booking.payFullNow && booking.depositAmount >= (service?.price ?? 0);

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
              payFullNow: isFullPayment,
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
              payFullNow: isFullPayment,
            }),
          });

          await syncBookingToGoogleCalendar(booking, service?.name ?? "Session", service?.durationMinutes ?? 60);

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
        }
      }
    }

    return c.json({ received: true }, 200);
  });

/**
 * Creates the Google Calendar event for a just-confirmed booking (sendUpdates: 'all' so the
 * patient's device gets the calendar invite notification) and stores the event id.
 * No-ops silently if Google Calendar isn't connected — never blocks the booking flow.
 */
async function syncBookingToGoogleCalendar(
  booking: { id: number; name: string; email: string; phone: string | null; date: string; startTime: string },
  serviceName: string,
  durationMinutes: number,
) {
  try {
    const eventId = await createCalendarEvent({
      bookingId: booking.id,
      summary: `${serviceName} — ${booking.name}`,
      description: `Nome: ${booking.name}\nServiço: ${serviceName}\nTelefone: ${booking.phone ?? "—"}`,
      date: booking.date,
      startTime: booking.startTime,
      durationMinutes,
      attendeeEmail: booking.email,
    });
    if (eventId) {
      await db.update(bookings).set({ googleEventId: eventId }).where(eq(bookings.id, booking.id));
    }
  } catch (err) {
    console.error("[bookings] failed to sync booking to Google Calendar", err);
  }
}
