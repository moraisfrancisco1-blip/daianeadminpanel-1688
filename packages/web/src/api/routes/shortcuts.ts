import { Hono } from "hono";
import { put } from "@vercel/blob";
import { db } from "../database";
import { bookings, invoices, expenses } from "../database/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { requireShortcutsToken } from "../middleware/shortcuts-auth";
import { extractExpenseFromFile } from "../services/expense-extract";
import { recordAudit } from "../lib/audit";

/**
 * iPhone Shortcuts / Scriptable widget API.
 *
 * PRIVACY: responses show up on a lock screen, so this is an ALLOWLIST —
 * first name + time only. Never client surnames, contact details, clinical
 * notes or free text. Every call is written to the Audit Log.
 */
const TZ = "Europe/Amsterdam";
const ACTOR = { id: null, email: "shortcuts@iphone" };

function amsterdamDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Epoch ms of 00:00 Europe/Amsterdam on a YYYY-MM-DD date (handles summer/winter time). */
function amsterdamMidnight(dateStr: string): number {
  const naive = Date.parse(`${dateStr}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(naive));
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const asLocal = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  return naive - (asLocal - naive);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";
const round2 = (n: number) => Math.round(n * 100) / 100;

export const shortcutsRoute = new Hono()
  .use("*", requireShortcutsToken)
  // Today's sessions: first name + time, and how many are still to come.
  .get("/today", async (c) => {
    const today = amsterdamDate();
    const rows = await db
      .select({ name: bookings.name, startTime: bookings.startTime, status: bookings.status, serviceId: bookings.serviceId })
      .from(bookings)
      .where(and(eq(bookings.date, today), inArray(bookings.status, ["confirmed", "completed", "pending_deposit"])));
    rows.sort((a, b) => a.startTime.localeCompare(b.startTime));

    const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const items = rows.map((r) => ({ time: r.startTime, name: firstName(r.name), done: r.status === "completed" || r.startTime < nowTime }));
    await recordAudit({ actor: ACTOR, action: "viewed", entityType: "shortcuts_today", metadata: { count: items.length } });
    return c.json({ date: today, total: items.length, remaining: items.filter((i) => !i.done).length, items }, 200);
  })
  // Money snapshot: only totals and counts, no client data.
  .get("/stats", async (c) => {
    const today = amsterdamDate();
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const weekStart = amsterdamMidnight(addDays(today, -dow));
    const dayStart = amsterdamMidnight(today);
    const dayEnd = amsterdamMidnight(addDays(today, 1));

    const all = await db
      .select({ status: invoices.status, total: invoices.total, paidAt: invoices.paidAt, dueDate: invoices.dueDate, isTest: invoices.isTest })
      .from(invoices)
      .where(and(eq(invoices.isTest, false), ne(invoices.status, "cancelled")));

    let day = 0;
    let week = 0;
    let overdueCount = 0;
    let overdueTotal = 0;
    let awaitingCount = 0;
    const now = Date.now();
    for (const i of all) {
      if (i.status === "paid" && i.paidAt) {
        const t = i.paidAt.getTime();
        if (t >= weekStart && t < dayEnd) week += i.total;
        if (t >= dayStart && t < dayEnd) day += i.total;
      } else if (i.status === "sent" || i.status === "overdue") {
        awaitingCount++;
        if (i.status === "overdue" || i.dueDate.getTime() < now) {
          overdueCount++;
          overdueTotal += i.total;
        }
      }
    }
    await recordAudit({ actor: ACTOR, action: "viewed", entityType: "shortcuts_stats" });
    return c.json(
      { revenueToday: round2(day), revenueWeek: round2(week), overdueCount, overdueTotal: round2(overdueTotal), awaitingCount },
      200,
    );
  })
  // Photo of a receipt -> blob storage + AI extraction. Saved flagged "REVER" in the notes so it
  // is obvious in the Expenses page that a person still has to check it before the VAT return.
  .post("/expense-scan", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ message: "No file uploaded", summary: "Nenhum ficheiro recebido." }, 400);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return c.json({ message: "Unsupported file type", summary: "Formato não suportado (usa JPEG, PNG, WebP ou PDF)." }, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    let attachmentUrl: string | null = null;
    try {
      const blob = await put(`expenses/${Date.now()}-${file.name || "receipt.jpg"}`, buffer, { access: "public", contentType: file.type });
      attachmentUrl = blob.url;
    } catch (err) {
      console.error("[shortcuts] Blob upload failed:", err);
      return c.json({ message: "Failed to store the file", summary: "Não consegui guardar a imagem." }, 500);
    }

    let extracted = null;
    try {
      extracted = await extractExpenseFromFile(buffer, file.type);
    } catch (err) {
      console.error("[shortcuts] Extraction failed:", err);
    }

    if (!extracted?.supplier || extracted.totalAmount == null || !extracted.issueDate) {
      await recordAudit({ actor: ACTOR, action: "scan_unreadable", entityType: "expense", metadata: { attachmentUrl } });
      return c.json({ saved: false, attachmentUrl, summary: "Não consegui ler o recibo. Adiciona-o manualmente no painel." }, 200);
    }

    const vatAmount = extracted.vatAmount ?? 0;
    const netAmount = extracted.netAmount ?? extracted.totalAmount - vatAmount;
    const [expense] = await db
      .insert(expenses)
      .values({
        supplier: extracted.supplier,
        category: extracted.category ?? null,
        invoiceNumber: extracted.invoiceNumber ?? null,
        issueDate: new Date(extracted.issueDate),
        netAmount,
        vatAmount,
        vatRate: extracted.vatRate ?? 0.21,
        totalAmount: extracted.totalAmount,
        notes: "REVER — digitalizado pelo iPhone",
        attachmentUrl,
        attachmentFilename: file.name || "receipt.jpg",
      })
      .returning();
    await recordAudit({
      actor: ACTOR,
      action: "created",
      entityType: "expense",
      entityId: expense!.id,
      metadata: { source: "shortcuts_scan", supplier: expense!.supplier, totalAmount: expense!.totalAmount },
    });
    return c.json(
      {
        saved: true,
        id: expense!.id,
        summary: `${expense!.supplier} · €${expense!.totalAmount.toFixed(2)} · ${extracted.issueDate} — guardado, falta rever no painel.`,
      },
      201,
    );
  });
