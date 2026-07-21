import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings } from "../database/schema";
import { eq, and, lt, ne, isNull, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { sendEmail } from "../services/email";
import { buildReminderEmailHtml, buildPostSessionEmailHtml } from "../lib/email-templates";
import { COMPANY } from "../lib/company";

const REMINDER_DAYS_AFTER_DUE = 10;

/** Offset (minutes) between a wall-clock time in `tz` and UTC, for the given instant. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    +map.year!,
    +map.month! - 1,
    +map.day!,
    +map.hour!,
    +map.minute!,
    +map.second!,
  );
  return (asUTC - date.getTime()) / 60000;
}

/** Epoch ms of a Europe/Amsterdam wall-clock date+time (handles summer/winter time). */
function amsterdamEpoch(dateStr: string, timeStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const naiveUTC = Date.UTC(y!, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  const offset = tzOffsetMinutes(new Date(naiveUTC), "Europe/Amsterdam");
  return naiveUTC - offset * 60000;
}

/**
 * Sends the trilingual review + promo email a few hours after each session.
 * Runs on the same cadence as reminders (dashboard open + external cron).
 * Only touches sessions from the last 14 days so first run never blasts old bookings.
 */
async function runPostSessionEmails() {
  const now = Date.now();
  const delayMs = COMPANY.postSessionEmailDelayHours * 60 * 60 * 1000;
  const oldestMs = now - 14 * 24 * 60 * 60 * 1000;

  const candidates = await db
    .select()
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, ["confirmed", "completed"]),
        isNull(bookings.postSessionEmailSentAt),
      ),
    );

  const sent: number[] = [];
  for (const b of candidates) {
    if (!b.email) continue;
    const sessionMs = amsterdamEpoch(b.date, b.startTime);
    // Session must have happened, be past the delay window, and not be ancient.
    if (sessionMs > oldestMs && now >= sessionMs + delayMs) {
      await sendEmail({
        to: b.email,
        subject: "Thank you 💛 / Obrigada / Bedankt — a little gift for your next session",
        html: buildPostSessionEmailHtml({
          name: b.name,
          reviewUrl: COMPANY.googleReviewUrl,
          instagramHandle: COMPANY.instagramHandle,
          instagramUrl: COMPANY.instagramUrl,
          promoAmount: COMPANY.postSessionPromoAmount,
        }),
      });
      await db
        .update(bookings)
        .set({ postSessionEmailSentAt: new Date() })
        .where(eq(bookings.id, b.id));
      sent.push(b.id);
    }
  }
  return sent;
}

async function runReminderCheck() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - REMINDER_DAYS_AFTER_DUE * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select()
    .from(invoices)
    .where(and(ne(invoices.status, "paid"), ne(invoices.status, "cancelled"), lt(invoices.dueDate, cutoff)));

  const sent: number[] = [];
  for (const invoice of candidates) {
    // already reminded in the last 10 days? skip
    if (invoice.lastReminderAt && now.getTime() - invoice.lastReminderAt.getTime() < REMINDER_DAYS_AFTER_DUE * 24 * 60 * 60 * 1000) {
      continue;
    }
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    if (!client?.email) continue;

    await sendEmail({
      to: client.email,
      subject: `Payment reminder — Invoice ${invoice.invoiceNumber}`,
      html: buildReminderEmailHtml({
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        dueDate: invoice.dueDate,
      }),
    });

    await db
      .update(invoices)
      .set({ status: "overdue", lastReminderAt: now, reminderCount: invoice.reminderCount + 1 })
      .where(eq(invoices.id, invoice.id));

    sent.push(invoice.id);
  }
  return sent;
}

export const remindersRoute = new Hono()
  // Trigger manually or via external scheduled call (e.g. cron-job.org hitting this URL daily)
  .post("/run", async (c) => {
    const sent = await runReminderCheck();
    const postSession = await runPostSessionEmails();
    return c.json({ sent, postSession }, 200);
  })
  // Send the post-session review/promo email immediately for one booking.
  .post("/post-session/:bookingId/send-now", requireAuth, async (c) => {
    const id = Number(c.req.param("bookingId"));
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!b) return c.json({ message: "Booking not found" }, 404);
    if (!b.email) return c.json({ message: "Booking has no email" }, 400);
    await sendEmail({
      to: b.email,
      subject: "Thank you 💛 / Obrigada / Bedankt — a little gift for your next session",
      html: buildPostSessionEmailHtml({
        name: b.name,
        reviewUrl: COMPANY.googleReviewUrl,
        instagramHandle: COMPANY.instagramHandle,
        instagramUrl: COMPANY.instagramUrl,
        promoAmount: COMPANY.postSessionPromoAmount,
      }),
    });
    await db.update(bookings).set({ postSessionEmailSentAt: new Date() }).where(eq(bookings.id, id));
    return c.json({ success: true }, 200);
  })
  .post("/:invoiceId/send-now", requireAuth, async (c) => {
    const id = Number(c.req.param("invoiceId"));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return c.json({ message: "Not found" }, 404);
    const [client] = await db.select().from(clients).where(eq(clients.id, invoice.clientId));
    if (!client?.email) return c.json({ message: "Client has no email" }, 400);

    await sendEmail({
      to: client.email,
      subject: `Payment reminder — Invoice ${invoice.invoiceNumber}`,
      html: buildReminderEmailHtml({
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        dueDate: invoice.dueDate,
      }),
    });

    await db
      .update(invoices)
      .set({ lastReminderAt: new Date(), reminderCount: invoice.reminderCount + 1 })
      .where(eq(invoices.id, id));

    return c.json({ success: true }, 200);
  })
  .get("/overdue", requireAuth, async (c) => {
    const now = new Date();
    const all = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        clientId: invoices.clientId,
        clientName: clients.name,
        dueDate: invoices.dueDate,
        total: invoices.total,
        reminderCount: invoices.reminderCount,
        lastReminderAt: invoices.lastReminderAt,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(ne(invoices.status, "paid"), ne(invoices.status, "cancelled"), lt(invoices.dueDate, now)));
    return c.json({ overdue: all }, 200);
  });
