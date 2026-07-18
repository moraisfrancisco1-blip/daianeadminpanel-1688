import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients } from "../database/schema";
import { eq, and, lt, ne } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { sendEmail } from "../services/email";
import { buildReminderEmailHtml } from "../lib/email-templates";

const REMINDER_DAYS_AFTER_DUE = 10;

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
    return c.json({ sent }, 200);
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
