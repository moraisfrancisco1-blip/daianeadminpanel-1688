import { Hono } from "hono";
import { db } from "../database";
import { bookings, services, clients, invoices, invoiceItems, blockedSlots } from "../database/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { stripe } from "../services/stripe";
import { sendEmail } from "../services/email";
import { buildBookingConfirmationHtml, buildAdminNewBookingHtml, buildRemainderPaymentEmailHtml } from "../lib/email-templates";
import { nextNumber } from "../lib/counters";
import { computeVat } from "../lib/totals";
import { COMPANY } from "../lib/company";
import { createCalendarEvent, getGoogleBusyIntervals, deleteCalendarEvent, updateCalendarEvent } from "../services/google-calendar";
import { sendAdminWhatsApp, buildBookingWhatsAppMessage } from "../services/whatsapp";
import { claimWebhookEvent, markWebhookEventProcessed, markWebhookEventFailed } from "../services/webhook-idempotency";

const BUFFER_MIN = 0; // no artificial gap between sessions — only real overlap is blocked
const SLOT_GRANULARITY_MIN = 15;

type DaySchedule = {
  startMin: number;
  endMin: number;
  blocks: { startMin: number; endMin: number }[];
};

// Centralized per-day availability (Mon/Wed/Fri). Days not listed have no availability.
const WEEKLY_SCHEDULE: Record<number, DaySchedule> = {
  1: { // Monday — block 09:00–10:00
    startMin: 9 * 60,
    endMin: 18 * 60,
    blocks: [{ startMin: 9 * 60, endMin: 10 * 60 }],
  },
  3: { // Wednesday — block 09:00–11:00
    startMin: 9 * 60,
    endMin: 18 * 60,
    blocks: [{ startMin: 9 * 60, endMin: 11 * 60 }],
  },
  5: { // Friday — starts 08:45, block 10:00–11:00
    startMin: 8 * 60 + 45,
    endMin: 18 * 60,
    blocks: [{ startMin: 10 * 60, endMin: 11 * 60 }],
  },
};

function scheduleFor(dateStr: string): DaySchedule | null {
  const day = new Date(dateStr + "T00:00:00").getDay();
  return WEEKLY_SCHEDULE[day] ?? null;
}

function isBlockedBySchedule(schedule: DaySchedule, startMin: number, endMin: number): boolean {
  return schedule.blocks.some((b) => startMin < b.endMin && endMin > b.startMin);
}

async function isSlotAvailable(date: string, startTime: string, durationMinutes: number, excludeBookingId?: number): Promise<boolean> {
  const schedule = scheduleFor(date);
  if (!schedule) return false;
  const start = timeToMinutes(startTime);
  const end = start + durationMinutes;
  if (start < schedule.startMin || end > schedule.endMin) return false;
  if (isBlockedBySchedule(schedule, start, end)) return false;

  // One-off blocked slots
  const blocked = await db.select().from(blockedSlots).where(eq(blockedSlots.date, date));
  const blockedOverlap = blocked.some((blk) => {
    const bs = timeToMinutes(blk.startTime);
    const be = timeToMinutes(blk.endTime);
    return start < be && end > bs;
  });
  if (blockedOverlap) return false;

  const allServices = await db.select().from(services);
  const serviceDuration = new Map(allServices.map((s) => [s.id, s.durationMinutes]));
  const overlapping = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.date, date), inArray(bookings.status, ["confirmed", "pending_deposit"])));

  return !overlapping.some((b) => {
    if (excludeBookingId != null && b.id === excludeBookingId) return false;
    const bs = timeToMinutes(b.startTime);
    const bd = serviceDuration.get(b.serviceId) ?? 60;
    return start < bs + bd + BUFFER_MIN && end > bs - BUFFER_MIN;
  });
}

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
    const schedule = scheduleFor(date);
    if (!schedule) return c.json({ slots: [] }, 200);

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

    // Static blocked intervals from the weekly schedule (e.g. 09:00–10:00 on Monday).
    for (const b of schedule.blocks) {
      busyIntervals.push({ start: b.startMin, end: b.endMin });
    }

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
    for (let start = schedule.startMin; start + duration <= schedule.endMin; start += SLOT_GRANULARITY_MIN) {
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

    if (!body.date || !body.startTime) {
      return c.json({ message: "Date and time are required" }, 400);
    }
    if (!(await isSlotAvailable(body.date, body.startTime, service.durationMinutes))) {
      return c.json({ message: "The selected time is not available" }, 409);
    }

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
        clientId: bookings.clientId,
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

    if (!body.date || !body.startTime) {
      return c.json({ message: "Date and time are required" }, 400);
    }
    if (!(await isSlotAvailable(body.date, body.startTime, service.durationMinutes))) {
      return c.json({ message: "The selected time is not available" }, 409);
    }

    // Find or create client (prefer explicit clientId, then email lookup, then create)
    let client = body.clientId
      ? (await db.select().from(clients).where(eq(clients.id, Number(body.clientId))))[0]
      : undefined;
    if (!client && body.email) {
      client = (await db.select().from(clients).where(eq(clients.email, body.email)))[0];
    }
    if (!client) {
      client = (
        await db
          .insert(clients)
          .values({ name: body.name, email: body.email, phone: body.phone ?? null })
          .returning()
      )[0];
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

    // Create an Admin invoice for the amount the client still owes
    // (service price minus any deposit already accounted for).
    // No Stripe Checkout Session is created here — the admin sends the payment
    // link later from the invoice or the booking detail.
    const deposit = booking!.depositAmount || 0;
    const pendingAmount = Number((service.price - deposit).toFixed(2));
    if (pendingAmount > 0) {
      const vatRate = service.vatRate;
      const { net, vat } = computeVat(pendingAmount, vatRate);
      const invoiceNumber = await nextNumber("invoice", new Date().getFullYear());
      const issueDate = new Date();
      const dueDate = new Date(issueDate.getTime() + 14 * 24 * 60 * 60 * 1000);

      const [invoice] = await db
        .insert(invoices)
        .values({
          invoiceNumber,
          clientId: client!.id,
          bookingId: booking!.id,
          status: "sent",
          issueDate,
          dueDate,
          notes: `Booking payment — ${service.name}`,
          subtotal: net,
          vatTotal: vat,
          total: pendingAmount,
        })
        .returning();

      await db.insert(invoiceItems).values({
        invoiceId: invoice!.id,
        serviceId: service.id,
        description: `${service.name} — booking payment`,
        quantity: 1,
        unitPrice: net,
        vatRate,
        amount: net,
      });

      await db.update(bookings).set({ invoiceId: invoice!.id }).where(eq(bookings.id, booking!.id));
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
        checkoutUrl: null,
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
  // Admin: edit/reschedule a booking (validates availability + syncs Google Calendar)
  .put("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const [existing] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!existing) return c.json({ message: "Booking not found" }, 404);

    const [service] = await db.select().from(services).where(eq(services.id, body.serviceId ?? existing.serviceId));
    if (!service) return c.json({ message: "Invalid service" }, 400);

    const date = body.date ?? existing.date;
    const startTime = body.startTime ?? existing.startTime;
    const status = body.status ?? existing.status;

    if (!(await isSlotAvailable(date, startTime, service.durationMinutes, id))) {
      return c.json({ message: "The selected time is not available" }, 409);
    }

    const [booking] = await db
      .update(bookings)
      .set({
        name: body.name ?? existing.name,
        email: body.email ?? existing.email,
        phone: body.phone ?? existing.phone,
        serviceId: service.id,
        date,
        startTime,
        notes: body.notes ?? existing.notes,
        status,
      })
      .where(eq(bookings.id, id))
      .returning();

    // Sync Google Calendar
    if (status === "cancelled") {
      if (existing.googleEventId) {
        await deleteCalendarEvent(existing.googleEventId);
        await db.update(bookings).set({ googleEventId: null }).where(eq(bookings.id, id));
      }
    } else if (existing.googleEventId) {
      await updateCalendarEvent({
        eventId: existing.googleEventId,
        summary: `${service.name} — ${booking!.name}`,
        description: `Nome: ${booking!.name}\nServiço: ${service.name}\nTelefone: ${booking!.phone ?? "—"}`,
        date,
        startTime,
        durationMinutes: service.durationMinutes,
        attendeeEmail: booking!.email,
      });
    } else if (status === "confirmed") {
      await syncBookingToGoogleCalendar(booking!, service.name, service.durationMinutes);
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
  // Admin: one-off blocked time slots (unavailable periods)
  .get("/blocked", requireAuth, async (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const rows = await db.select().from(blockedSlots);
    const filtered = from || to
      ? rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to))
      : rows;
    filtered.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    return c.json({ blocked: filtered }, 200);
  })
  .post("/blocked", requireAuth, async (c) => {
    const body = await c.req.json();
    if (!body.date || !body.startTime || !body.endTime) {
      return c.json({ message: "date, startTime and endTime are required" }, 400);
    }
    const [block] = await db
      .insert(blockedSlots)
      .values({ date: body.date, startTime: body.startTime, endTime: body.endTime, reason: body.reason ?? null })
      .returning();
    return c.json({ block }, 201);
  })
  .delete("/blocked/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    await db.delete(blockedSlots).where(eq(blockedSlots.id, id));
    return c.json({ success: true }, 200);
  })
  // Stripe webhook — confirms deposit/payment and auto-creates a draft invoice
  .post("/webhook/stripe", async (c) => {
    if (!stripe) return c.json({ message: "Stripe not configured" }, 400);
    const sig = c.req.header("stripe-signature");
    const body = await c.req.text();
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err) {
      return c.json({ message: "Invalid signature" }, 400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: { bookingId?: string } };
      const bookingId = Number(session.metadata?.bookingId);
      if (bookingId) {
        // Idempotency: claim with a persistent state machine (processing -> processed/failed).
        const claim = await claimWebhookEvent(event.id, event.type);
        if (claim === "skip") {
          console.log("[bookings/webhook] Duplicate checkout event, skipping:", event.id);
          return c.json({ received: true }, 200);
        }

        try {
          const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
          if (!booking) {
            console.log("[bookings/webhook] Booking not found:", bookingId);
            await markWebhookEventProcessed(event.id);
            return c.json({ received: true }, 200);
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
            return c.json({ received: true }, 200);
          }

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

          await markWebhookEventProcessed(event.id);
        } catch (error) {
          await markWebhookEventFailed(event.id, error instanceof Error ? error.message : String(error));
          return c.json({ message: "Error processing event" }, 500);
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
