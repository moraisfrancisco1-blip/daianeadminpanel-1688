import { Hono } from "hono";
import { db } from "../database";
import { bookings, services, clients, invoices, invoiceItems } from "../database/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { stripe } from "../services/stripe";
import { sendEmail } from "../services/email";
import { buildBookingConfirmationHtml, buildAdminNewBookingHtml } from "../lib/email-templates";
import { nextNumber } from "../lib/counters";
import { COMPANY } from "../lib/company";

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
          payFullNow: true,
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
      return c.json({ booking, checkoutUrl: null, message: "Stripe not configured yet" }, 201);
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
  .put("/:id/status", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const { status } = await c.req.json();
    const [booking] = await db.update(bookings).set({ status }).where(eq(bookings.id, id)).returning();
    return c.json({ booking }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
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

          await sendEmail({
            to: booking.email,
            subject: "Booking confirmed — Studio Daï Oakes",
            html: buildBookingConfirmationHtml({
              name: booking.name,
              serviceName: service?.name ?? "Session",
              date: booking.date,
              startTime: booking.startTime,
              payFullNow: booking.payFullNow,
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
        }
      }
    }

    return c.json({ received: true }, 200);
  });
