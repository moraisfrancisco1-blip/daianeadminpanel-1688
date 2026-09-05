import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings } from "../database/schema";
import { eq, and, lt, ne, isNull, inArray, gt } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { sendTrackedEmail } from "../services/email-log";
import { buildReminderEmailHtml, buildPostSessionEmailHtml, buildSessionReminderEmailHtml, buildRebookReminderEmailHtml } from "../lib/email-templates";
import { COMPANY } from "../lib/company";
import { services } from "../database/schema";

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
      await sendTrackedEmail({
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

/** Returns the YYYY-MM-DD date string for "today + offsetDays" in Europe/Amsterdam time. */
function amsterdamDateStrPlusDays(offsetDays: number): string {
  const nowAmsMs = Date.now() + tzOffsetMinutes(new Date(), "Europe/Amsterdam") * 60000;
  const target = new Date(nowAmsMs + offsetDays * 24 * 60 * 60 * 1000);
  const y = target.getUTCFullYear();
  const mo = String(target.getUTCMonth() + 1).padStart(2, "0");
  const d = String(target.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/**
 * Sends "session in 2 days" / "session tomorrow" reminder emails.
 * Matches confirmed bookings whose `date` is exactly 2 or 1 day(s) from now (Amsterdam time)
 * and that haven't already received that specific reminder.
 */
async function runSessionReminderCheck() {
  const sent: { bookingId: number; daysAway: 1 | 2 }[] = [];

  for (const daysAway of [2, 1] as const) {
    const targetDate = amsterdamDateStrPlusDays(daysAway);
    const sentAtColumn = daysAway === 2 ? bookings.reminder2dSentAt : bookings.reminder1dSentAt;

    const candidates = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.date, targetDate),
          eq(bookings.status, "confirmed"),
          isNull(sentAtColumn),
        ),
      );

    for (const b of candidates) {
      if (!b.email) continue;
      const [service] = await db.select().from(services).where(eq(services.id, b.serviceId));

      await sendTrackedEmail({
        to: b.email,
        subject: daysAway === 2 ? "Your session is in 2 days" : "Your session is tomorrow",
        html: buildSessionReminderEmailHtml({
          clientName: b.name,
          serviceName: service?.name ?? "your session",
          date: b.date,
          startTime: b.startTime,
          daysAway,
        }),
      });

      await db
        .update(bookings)
        .set(daysAway === 2 ? { reminder2dSentAt: new Date() } : { reminder1dSentAt: new Date() })
        .where(eq(bookings.id, b.id));

      sent.push({ bookingId: b.id, daysAway });
    }
  }

  return sent;
}

/**
 * Sends a "come back and rebook" email to clients whose last completed session
 * was REBOOK_DAYS ago and who have no upcoming confirmed booking.
 */
async function runRebookReminderCheck() {
  const REBOOK_DAYS = 28;
  const targetDate = amsterdamDateStrPlusDays(-REBOOK_DAYS);

  const candidates = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "completed"), eq(bookings.date, targetDate), isNull(bookings.rebookReminderSentAt)));

  const sent: number[] = [];
  for (const b of candidates) {
    if (!b.email) continue;

    const upcoming = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.email, b.email), eq(bookings.status, "confirmed"), gt(bookings.date, b.date)));
    if (upcoming.length > 0) continue;

    await sendTrackedEmail({
      to: b.email,
      subject: "Let's schedule your next session ✨",
      html: buildRebookReminderEmailHtml({ name: b.name }),
    });

    await db.update(bookings).set({ rebookReminderSentAt: new Date() }).where(eq(bookings.id, b.id));
    sent.push(b.id);
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

    await sendTrackedEmail({
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
  // Trigger manually from the Admin Panel (dashboard) or an authenticated client.
  .post("/run", requireAuth, async (c) => {
    const sent = await runReminderCheck();
    const postSession = await runPostSessionEmails();
    const sessionReminders = await runSessionReminderCheck();
    const rebook = await runRebookReminderCheck();
    return c.json({ sent, postSession, sessionReminders, rebook }, 200);
  })
  // Vercel Cron hits this with a GET request and, when CRON_SECRET is set on the
  // project, an automatic "Authorization: Bearer <CRON_SECRET>" header — this is
  // what makes reminders keep firing on days nobody opens the dashboard. See
  // vercel.json for the schedule. Not linked from the UI; no admin session exists
  // for a cron-triggered request, so it's authenticated by the shared secret instead.
  .get("/cron", async (c) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return c.json({ message: "CRON_SECRET is not configured" }, 501);
    const auth = c.req.header("authorization");
    if (auth !== `Bearer ${secret}`) return c.json({ message: "Unauthorized" }, 401);
    const sent = await runReminderCheck();
    const postSession = await runPostSessionEmails();
    const sessionReminders = await runSessionReminderCheck();
    const rebook = await runRebookReminderCheck();
    return c.json({ sent, postSession, sessionReminders, rebook }, 200);
  })
  // Send the post-session review/promo email immediately for one booking.
  .post("/post-session/:bookingId/send-now", requireAuth, async (c) => {
    const id = Number(c.req.param("bookingId"));
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
    if (!b) return c.json({ message: "Booking not found" }, 404);
    if (!b.email) return c.json({ message: "Booking has no email" }, 400);
    await sendTrackedEmail({
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

    await sendTrackedEmail({
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
