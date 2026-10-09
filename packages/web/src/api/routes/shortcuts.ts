import { Hono } from "hono";
import { put } from "@vercel/blob";
import { db } from "../database";
import { bookings, invoices, expenses, clients, packages, services } from "../database/schema";
import { and, desc, eq, gte, inArray, like, ne } from "drizzle-orm";
import { requireShortcutsToken } from "../middleware/shortcuts-auth";
import { extractExpenseFromFile } from "../services/expense-extract";
import { recordAudit } from "../lib/audit";
import { bookingsRoute } from "./bookings";
import { getCheckoutResult, ensurePayToken, payUrl } from "../lib/invoice-checkout";

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

// Booking goes through the SAME code path as the panel's manual booking (availability check, client
// handling, invoice, confirmation emails) — never a second copy of those rules. This tiny wrapper
// only supplies the signed-in "user" that route expects, and is reachable solely after the
// SHORTCUTS_TOKEN check above.
const asAdmin = new Hono()
  .use("*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("user", { id: null, email: ACTOR.email, role: "admin" });
    await next();
  })
  .route("/", bookingsRoute);

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
  // Packages worth a renewal chat: 1 session left or fewer, or expiring within 14 days.
  // First name + counts only — safe for a widget.
  .get("/packages-expiring", async (c) => {
    const rows = await db
      .select({ name: clients.name, total: packages.totalSessions, used: packages.sessionsUsed, expiresAt: packages.expiresAt })
      .from(packages)
      .innerJoin(clients, eq(packages.clientId, clients.id));
    const now = Date.now();
    const items = rows
      .map((r) => ({
        name: firstName(r.name),
        remaining: r.total - r.used,
        daysLeft: r.expiresAt ? Math.ceil((r.expiresAt.getTime() - now) / 86_400_000) : null,
      }))
      .filter((r) => r.remaining > 0 && (r.remaining <= 1 || (r.daysLeft !== null && r.daysLeft <= 14)) && (r.daysLeft === null || r.daysLeft >= 0))
      .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || a.remaining - b.remaining);
    await recordAudit({ actor: ACTOR, action: "viewed", entityType: "shortcuts_packages", metadata: { count: items.length } });
    return c.json({ total: items.length, items }, 200);
  })
  // "Próxima cliente": the next session today, and whether she has an active package / an unpaid invoice.
  .get("/next", async (c) => {
    const today = amsterdamDate();
    const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const rows = await db
      .select({ name: bookings.name, startTime: bookings.startTime, clientId: bookings.clientId, invoiceId: bookings.invoiceId })
      .from(bookings)
      .where(and(eq(bookings.date, today), inArray(bookings.status, ["confirmed", "pending_deposit"])));
    const next = rows.filter((r) => r.startTime >= nowTime).sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
    if (!next) return c.json({ found: false, summary: "Não há mais marcações hoje." }, 200);

    let hasActivePackage = false;
    if (next.clientId) {
      const pk = await db.select({ total: packages.totalSessions, used: packages.sessionsUsed, expiresAt: packages.expiresAt }).from(packages).where(eq(packages.clientId, next.clientId));
      hasActivePackage = pk.some((p) => p.used < p.total && (!p.expiresAt || p.expiresAt.getTime() > Date.now()));
    }
    let paymentPending = false;
    if (next.invoiceId) {
      const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, next.invoiceId));
      paymentPending = !!inv && inv.status !== "paid" && inv.status !== "cancelled";
    }
    const name = firstName(next.name);
    const summary = `A seguir: ${name} às ${next.startTime}. ${hasActivePackage ? "Tem pacote ativo." : "Sem pacote ativo."} ${paymentPending ? "Pagamento pendente." : "Sem pagamento pendente."}`;
    await recordAudit({ actor: ACTOR, action: "viewed", entityType: "shortcuts_next" });
    return c.json({ found: true, name, time: next.startTime, hasActivePackage, paymentPending, summary }, 200);
  })
  // Client picker for the "Link de pagamento" shortcut (a person running her own shortcut, not a lock-screen widget).
  .get("/clients", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json({ clients: [] }, 200);
    const rows = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(like(clients.name, `%${q.replace(/[%_]/g, "")}%`))
      .limit(8);
    await recordAudit({ actor: ACTOR, action: "searched", entityType: "shortcuts_clients", metadata: { results: rows.length } });
    return c.json({ clients: rows }, 200);
  })
  // Durable payment link for a client's latest unpaid invoice (never creates or changes an invoice).
  .post("/payment-link", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const clientId = Number((body as { clientId?: unknown }).clientId);
    if (!Number.isInteger(clientId)) return c.json({ message: "clientId is required", summary: "Falta escolher a cliente." }, 400);

    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    if (!client) return c.json({ message: "Client not found", summary: "Cliente não encontrada." }, 404);
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.clientId, clientId), eq(invoices.isTest, false), inArray(invoices.status, ["draft", "sent", "overdue"])))
      .orderBy(desc(invoices.issueDate))
      .limit(1);
    if (!invoice) return c.json({ message: "No unpaid invoice", summary: `${firstName(client.name)} não tem faturas por pagar.` }, 404);

    const origin = process.env.WEBSITE_URL ?? "";
    const result = await getCheckoutResult(invoice, client, origin);
    if ("reason" in result) return c.json({ message: result.reason, summary: result.reason }, 500);
    const url = payUrl(await ensurePayToken(invoice));
    await recordAudit({ actor: ACTOR, action: "payment_link_created", entityType: "invoice", entityId: invoice.id, metadata: { source: "shortcuts" } });
    return c.json(
      {
        url,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        phone: client.phone,
        firstName: firstName(client.name),
        summary: `Fatura ${invoice.invoiceNumber} · €${invoice.total.toFixed(2)}`,
      },
      200,
    );
  })
  // Active services for the "Marcar sessão" picker.
  .get("/services", async (c) => {
    const rows = await db
      .select({ id: services.id, name: services.name, price: services.price, durationMinutes: services.durationMinutes })
      .from(services)
      .where(eq(services.active, true));
    return c.json({ services: rows }, 200);
  })
  // "Marcar sessão": client + service + day + time. 409 when the slot is taken.
  .post("/book", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = Number(body.clientId);
    const serviceId = Number(body.serviceId);
    const date = String(body.date ?? "");
    const startTime = String(body.startTime ?? "");
    if (!Number.isInteger(clientId) || !Number.isInteger(serviceId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) {
      return c.json({ message: "clientId, serviceId, date (YYYY-MM-DD) and startTime (HH:MM) are required", summary: "Faltam dados: cliente, serviço, dia ou hora." }, 400);
    }
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    if (!client) return c.json({ message: "Client not found", summary: "Cliente não encontrada." }, 404);
    if (!client.email) return c.json({ message: "Client has no email", summary: `${firstName(client.name)} não tem email — marca no painel.` }, 400);

    const res = await asAdmin.request("/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, name: client.name, email: client.email, phone: client.phone, serviceId, date, startTime }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; booking?: { id: number } };
    if (!res.ok) {
      const summary = res.status === 409 ? "Esse horário não está disponível." : (data.message ?? "Não foi possível marcar.");
      return c.json({ message: data.message, summary }, res.status as 400 | 409 | 500);
    }
    await recordAudit({ actor: ACTOR, action: "created", entityType: "booking", entityId: data.booking?.id, metadata: { source: "shortcuts" } });
    return c.json({ id: data.booking?.id, summary: `Marcado: ${firstName(client.name)} · ${date} às ${startTime}.` }, 201);
  })
  // "Fim de sessão" (NFC tag): marks today's most recent started session as completed.
  // Package sessions are already deducted when the booking is made, and the review email goes out
  // automatically after the delay, so nothing else is triggered here (no double deduction).
  .post("/complete-session", async (c) => {
    const today = amsterdamDate();
    const nowTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const rows = await db
      .select({ id: bookings.id, name: bookings.name, startTime: bookings.startTime, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.date, today), eq(bookings.status, "confirmed")));
    const current = rows.filter((r) => r.startTime <= nowTime).sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
    if (!current) return c.json({ done: false, summary: "Não há nenhuma sessão em curso para concluir." }, 200);
    await db.update(bookings).set({ status: "completed" }).where(eq(bookings.id, current.id));
    await recordAudit({ actor: ACTOR, action: "completed", entityType: "booking", entityId: current.id, metadata: { source: "shortcuts" } });
    return c.json({ done: true, summary: `Sessão das ${current.startTime} (${firstName(current.name)}) concluída.` }, 200);
  })
  // 7:00 briefing: counts and the first session — nothing clinical, safe on a lock screen.
  .get("/briefing", async (c) => {
    const today = amsterdamDate();
    const sessions = await db
      .select({ startTime: bookings.startTime })
      .from(bookings)
      .where(and(eq(bookings.date, today), inArray(bookings.status, ["confirmed", "pending_deposit"])));
    sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));

    const overdue = await db
      .select({ total: invoices.total, status: invoices.status, dueDate: invoices.dueDate })
      .from(invoices)
      .where(and(eq(invoices.isTest, false), inArray(invoices.status, ["sent", "overdue"])));
    const now = Date.now();
    const late = overdue.filter((i) => i.status === "overdue" || i.dueDate.getTime() < now);

    const since = new Date(now - 14 * 60 * 60 * 1000);
    const overnight = await db.select({ id: bookings.id }).from(bookings).where(and(gte(bookings.createdAt, since), eq(bookings.isGroupBooking, false)));

    const parts = [
      sessions.length ? `${sessions.length} marcaç${sessions.length === 1 ? "ão" : "ões"} hoje, a primeira às ${sessions[0]!.startTime}` : "Sem marcações hoje",
      late.length ? `${late.length} fatura${late.length === 1 ? "" : "s"} em atraso (€${round2(late.reduce((n, i) => n + i.total, 0))})` : "Sem faturas em atraso",
      overnight.length ? `${overnight.length} nova${overnight.length === 1 ? "" : "s"} marcaç${overnight.length === 1 ? "ão" : "ões"} desde ontem` : null,
    ].filter(Boolean);
    await recordAudit({ actor: ACTOR, action: "viewed", entityType: "shortcuts_briefing" });
    return c.json({ summary: parts.join(". ") + "." }, 200);
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
