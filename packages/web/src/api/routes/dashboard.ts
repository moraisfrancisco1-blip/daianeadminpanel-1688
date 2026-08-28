import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings, invoiceItems, services, payments } from "../database/schema";
import { requireAuth } from "../middleware/auth";
import { eq } from "drizzle-orm";
import { stripe } from "../services/stripe";

// ── Timezone helpers (Europe/Amsterdam) ──────────────────────────────
const AMS = "Europe/Amsterdam";

function amsDateOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AMS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function amsTodayStr(): string {
  return amsDateOf(new Date());
}

/** Current time-of-day in Europe/Amsterdam, expressed as minutes since midnight. */
function amsNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: AMS,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** "HH:MM" -> minutes since midnight. */
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Monday (YYYY-MM-DD) of the week containing the given YYYY-MM-DD date. */
function mondayOf(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const day = new Date(y!, (mo ?? 1) - 1, d ?? 1).getDay();
  const diff = day === 0 ? 6 : day - 1;
  const m = new Date(y!, (mo ?? 1) - 1, (d ?? 1) - diff);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-${String(m.getDate()).padStart(2, "0")}`;
}

function previousMonthKey(todayStr: string): string {
  const [y, mo] = todayStr.split("-").map(Number);
  const d = new Date(y!, (mo ?? 1) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const sumTotal = (rows: { total: number }[]): number =>
  Number(rows.reduce((s, r) => s + r.total, 0).toFixed(2));

export const dashboardRoute = new Hono()
  .get("/stats", requireAuth, async (c) => {
    const allInvoices = await db.select().from(invoices);
    const allClients = await db.select().from(clients);
    const allBookings = await db.select().from(bookings);

    const now = new Date();
    const today = amsTodayStr();
    const monday = mondayOf(today);
    const ym = today.slice(0, 7);
    const yearStr = today.slice(0, 4);
    const prevYm = previousMonthKey(today);

    const paid = allInvoices.filter((i) => i.status === "paid");
    const paidWithAt = paid.filter((i) => i.paidAt);
    const overdue = allInvoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.dueDate < now);
    const pending = allInvoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.dueDate >= now);

    // Received (paid) per period — based on the actual paid date.
    const revenueToday = sumTotal(paidWithAt.filter((i) => amsDateOf(i.paidAt!) === today));
    const revenueThisWeek = sumTotal(
      paidWithAt.filter((i) => {
        const d = amsDateOf(i.paidAt!);
        return d >= monday && d <= today;
      }),
    );
    const revenueThisMonth = sumTotal(paidWithAt.filter((i) => amsDateOf(i.paidAt!).startsWith(ym)));
    const revenueThisYear = sumTotal(paidWithAt.filter((i) => amsDateOf(i.paidAt!).startsWith(yearStr)));
    const prevMonthRevenue = sumTotal(paidWithAt.filter((i) => amsDateOf(i.paidAt!).startsWith(prevYm)));

    // Billed vs received vs pending (this month).
    const billedThisMonth = sumTotal(allInvoices.filter((i) => amsDateOf(i.issueDate).startsWith(ym)));
    const pendingTotal = sumTotal([...overdue, ...pending]);

    const totalRevenue = sumTotal(paid);
    let totalRevenueNet = totalRevenue;
    if (stripe) {
      try {
        const balance = await stripe.balance.retrieve();
        const netCents = (balance.available ?? []).reduce((s, b) => s + b.amount, 0)
          + (balance.pending ?? []).reduce((s, b) => s + b.amount, 0);
        if (netCents > 0) {
          totalRevenueNet = netCents / 100;
        }
      } catch {
        // fallback to gross if Stripe call fails
      }
    }

    const activeSessions = allBookings.filter((b) => b.status === "confirmed" || b.status === "completed");
    const sessionsThisMonth = activeSessions.filter((b) => b.date.startsWith(ym)).length;
    const totalSessions = activeSessions.length;

    return c.json(
      {
        totalClients: allClients.length,
        totalInvoices: allInvoices.length,
        paidCount: paid.length,
        overdueCount: overdue.length,
        pendingCount: pending.length,
        revenueToday,
        revenueThisWeek,
        revenueThisMonth,
        revenueThisYear,
        prevMonthRevenue,
        billedThisMonth,
        paidThisMonth: revenueThisMonth,
        pendingTotal,
        totalRevenue: Number(totalRevenueNet.toFixed(2)),
        outstandingTotal: Number(pendingTotal.toFixed(2)),
        sessionsThisMonth,
        totalSessions,
        upcomingBookings: allBookings.filter((b) => b.status === "confirmed" && b.date >= today).length,
      },
      200,
    );
  })
  .get("/revenue-chart", requireAuth, async (c) => {
    const months = Number(c.req.query("months") ?? 6);
    const paidInvoices = await db.select().from(invoices).where(eq(invoices.status, "paid"));

    const now = new Date();
    const buckets: { month: string; label: string; revenue: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({ month: key, label: d.toLocaleString("en-GB", { month: "short" }), revenue: 0 });
    }
    const bucketMap = new Map(buckets.map((b) => [b.month, b]));

    for (const inv of paidInvoices) {
      if (!inv.paidAt) continue;
      const key = `${inv.paidAt.getFullYear()}-${String(inv.paidAt.getMonth() + 1).padStart(2, "0")}`;
      const bucket = bucketMap.get(key);
      if (bucket) bucket.revenue = Number((bucket.revenue + inv.total).toFixed(2));
    }

    return c.json({ chart: buckets }, 200);
  })
  .get("/service-breakdown", requireAuth, async (c) => {
    const items = await db
      .select({
        serviceId: invoiceItems.serviceId,
        description: invoiceItems.description,
        amount: invoiceItems.amount,
        invoiceId: invoiceItems.invoiceId,
      })
      .from(invoiceItems);

    const invoiceStatusMap = new Map((await db.select().from(invoices)).map((i) => [i.id, i.status]));

    const byService = new Map<string, { name: string; revenue: number; count: number }>();
    for (const item of items) {
      if (invoiceStatusMap.get(item.invoiceId) !== "paid") continue;
      const key = item.description;
      const existing = byService.get(key) ?? { name: key, revenue: 0, count: 0 };
      existing.revenue = Number((existing.revenue + item.amount).toFixed(2));
      existing.count += 1;
      byService.set(key, existing);
    }

    const breakdown = Array.from(byService.values()).sort((a, b) => b.revenue - a.revenue);
    return c.json({ breakdown }, 200);
  })
  .get("/top-clients", requireAuth, async (c) => {
    const limit = Number(c.req.query("limit") ?? 5);
    const paidInvoices = await db.select().from(invoices).where(eq(invoices.status, "paid"));
    const allClients = await db.select().from(clients);
    const clientMap = new Map(allClients.map((c2) => [c2.id, c2.name]));

    const byClient = new Map<number, { clientId: number; name: string; revenue: number; sessionCount: number }>();
    for (const inv of paidInvoices) {
      const existing = byClient.get(inv.clientId) ?? {
        clientId: inv.clientId,
        name: clientMap.get(inv.clientId) ?? "Unknown",
        revenue: 0,
        sessionCount: 0,
      };
      existing.revenue = Number((existing.revenue + inv.total).toFixed(2));
      existing.sessionCount += 1;
      byClient.set(inv.clientId, existing);
    }

    const top = Array.from(byClient.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
    return c.json({ topClients: top }, 200);
  })
  .get("/upcoming-bookings", requireAuth, async (c) => {
    const limit = Number(c.req.query("limit") ?? 8);
    const today = amsTodayStr();
    const allBookings = await db.select().from(bookings);
    const allServices = await db.select().from(services);
    const serviceMap = new Map(allServices.map((s) => [s.id, s.name]));

    const upcoming = allBookings
      .filter((b) => b.status === "confirmed" && b.date >= today)
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
      .slice(0, limit)
      .map((b) => ({
        id: b.id,
        name: b.name,
        serviceName: serviceMap.get(b.serviceId) ?? "Unknown",
        date: b.date,
        startTime: b.startTime,
      }));

    return c.json({ upcoming }, 200);
  })
  .get("/vat-summary", requireAuth, async (c) => {
    const year = Number(c.req.query("year") ?? new Date().getFullYear());
    const month = Number(c.req.query("month") ?? new Date().getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const paidInvoices = (await db.select().from(invoices).where(eq(invoices.status, "paid"))).filter(
      (i) => i.paidAt && i.paidAt >= start && i.paidAt < end,
    );

    const items = await db.select().from(invoiceItems);
    const paidIds = new Set(paidInvoices.map((i) => i.id));

    const byRate = new Map<number, { rate: number; base: number; vat: number }>();
    for (const item of items) {
      if (!paidIds.has(item.invoiceId)) continue;
      const existing = byRate.get(item.vatRate) ?? { rate: item.vatRate, base: 0, vat: 0 };
      existing.base = Number((existing.base + item.amount).toFixed(2));
      existing.vat = Number((existing.vat + item.amount * item.vatRate).toFixed(2));
      byRate.set(item.vatRate, existing);
    }

    return c.json(
      {
        year,
        month,
        breakdown: Array.from(byRate.values()).sort((a, b) => a.rate - b.rate),
        totalBase: Number(Array.from(byRate.values()).reduce((s, b) => s + b.base, 0).toFixed(2)),
        totalVat: Number(Array.from(byRate.values()).reduce((s, b) => s + b.vat, 0).toFixed(2)),
      },
      200,
    );
  })
  .get("/activity-feed", requireAuth, async (c) => {
    const limit = Number(c.req.query("limit") ?? 12);
    const allInvoices = await db.select().from(invoices);
    const allBookings = await db.select().from(bookings);
    const allPayments = await db.select().from(payments);
    const allClients = await db.select().from(clients);
    const clientMap = new Map(allClients.map((c2) => [c2.id, c2.name]));

    type Event = { type: string; date: Date; text: string };
    const events: Event[] = [];

    for (const inv of allInvoices) {
      events.push({
        type: "invoice_created",
        date: inv.createdAt,
        text: `Invoice ${inv.invoiceNumber} created for ${clientMap.get(inv.clientId) ?? "Unknown"} — €${inv.total.toFixed(2)}`,
      });
      if (inv.paidAt) {
        events.push({
          type: "invoice_paid",
          date: inv.paidAt,
          text: `Invoice ${inv.invoiceNumber} paid by ${clientMap.get(inv.clientId) ?? "Unknown"} — €${inv.total.toFixed(2)}`,
        });
      }
    }
    for (const b of allBookings) {
      if (b.status === "confirmed" || b.status === "completed") {
        events.push({
          type: "booking_confirmed",
          date: b.createdAt,
          text: `Booking confirmed — ${b.name} on ${b.date} at ${b.startTime}`,
        });
      }
    }
    for (const p of allPayments) {
      events.push({ type: "payment", date: p.paidAt, text: `Payment of €${p.amount.toFixed(2)} recorded (${p.method})` });
    }

    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    return c.json({ events: events.slice(0, limit) }, 200);
  })
  .get("/stripe-commissions", requireAuth, async (c) => {
    if (!stripe) {
      return c.json({ available: false, message: "Stripe not configured" }, 200);
    }

    const year = Number(c.req.query("year") ?? new Date().getFullYear());
    const month = Number(c.req.query("month") ?? new Date().getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const startTimestamp = Math.floor(start.getTime() / 1000);
    const endTimestamp = Math.floor(end.getTime() / 1000);

    let totalFees = 0;
    let totalGross = 0;
    let totalNet = 0;
    let transactionCount = 0;
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: Record<string, unknown> = {
        limit: 100,
        created: { gte: startTimestamp, lt: endTimestamp },
        type: "charge",
      };
      if (startingAfter) params.starting_after = startingAfter;

      const transactions = await stripe.balanceTransactions.list(params as Parameters<typeof stripe.balanceTransactions.list>[0]);

      for (const tx of transactions.data) {
        totalFees += tx.fee;
        totalGross += tx.amount;
        totalNet += tx.net;
        transactionCount++;
      }

      hasMore = transactions.has_more;
      const lastTx = transactions.data[transactions.data.length - 1];
      if (lastTx) {
        startingAfter = lastTx.id;
      }
    }

    return c.json(
      {
        available: true,
        year,
        month,
        totalFees: Number((totalFees / 100).toFixed(2)),
        totalGross: Number((totalGross / 100).toFixed(2)),
        totalNet: Number((totalNet / 100).toFixed(2)),
        transactionCount,
      },
      200,
    );
  })
  .get("/today", requireAuth, async (c) => {
    const today = amsTodayStr();
    const todaysBookings = await db.select().from(bookings).where(eq(bookings.date, today));
    todaysBookings.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const allServices = await db.select().from(services);
    const serviceMap = new Map(allServices.map((s) => [s.id, s]));

    const sessions = todaysBookings.map((b) => ({
      id: b.id,
      name: b.name,
      startTime: b.startTime,
      status: b.status,
      serviceName: serviceMap.get(b.serviceId)?.name ?? "—",
      durationMinutes: serviceMap.get(b.serviceId)?.durationMinutes ?? 60,
      depositStatus: b.depositStatus,
    }));

    // "Próximo cliente" = first confirmed session today whose end time has NOT yet passed
    // (compared with the current time in Europe/Amsterdam). Already-finished sessions are skipped.
    const nowMin = amsNowMinutes();
    const nextCandidates = sessions.filter(
      (s) => s.status === "confirmed" && timeToMin(s.startTime) + (s.durationMinutes ?? 60) > nowMin,
    );

    return c.json(
      {
        date: today,
        sessions,
        nextClient: nextCandidates[0] ?? null,
        confirmedCount: sessions.filter((s) => s.status === "confirmed").length,
        completedCount: sessions.filter((s) => s.status === "completed").length,
        cancelledCount: sessions.filter((s) => s.status === "cancelled").length,
      },
      200,
    );
  })
  .get("/alerts", requireAuth, async (c) => {
    const now = new Date();
    const today = amsTodayStr();
    const allInvoices = await db.select().from(invoices);
    const allClients = await db.select().from(clients);
    const allBookings = await db.select().from(bookings);
    const allServices = await db.select().from(services);
    const clientMap = new Map(allClients.map((cl) => [cl.id, cl.name]));
    const serviceMap = new Map(allServices.map((s) => [s.id, s.name]));

    type Alert = { id: string; severity: "high" | "medium" | "info"; title: string; detail: string; link: string };
    const alerts: Alert[] = [];

    // 1. Overdue invoices (high)
    for (const inv of allInvoices) {
      if (inv.status !== "paid" && inv.status !== "cancelled" && inv.dueDate < now) {
        alerts.push({
          id: `overdue-${inv.id}`,
          severity: "high",
          title: `Invoice vencida · ${inv.invoiceNumber}`,
          detail: `${clientMap.get(inv.clientId) ?? "Cliente"} · €${inv.total.toFixed(2)} · venceu a ${amsDateOf(inv.dueDate)}`,
          link: "/invoices",
        });
      }
    }

    // 2. Sent (pending payment) invoices (medium)
    for (const inv of allInvoices) {
      if (inv.status === "sent") {
        alerts.push({
          id: `pending-${inv.id}`,
          severity: "medium",
          title: `Pagamento pendente · ${inv.invoiceNumber}`,
          detail: `${clientMap.get(inv.clientId) ?? "Cliente"} · €${inv.total.toFixed(2)} · vence a ${amsDateOf(inv.dueDate)}`,
          link: "/invoices",
        });
      }
    }

    // 3. Today's confirmed sessions (info)
    for (const b of allBookings) {
      if (b.date === today && b.status === "confirmed") {
        alerts.push({
          id: `today-${b.id}`,
          severity: "info",
          title: `Sessão hoje · ${b.name}`,
          detail: `${b.startTime} · ${serviceMap.get(b.serviceId) ?? "—"}`,
          link: "/bookings",
        });
      }
    }

    // 4. Clients without a session in the last 60 days (medium)
    const DAYS = 60;
    const cutoff = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);
    const lastBookingByClient = new Map<number, Date>();
    for (const b of allBookings) {
      if (b.clientId == null) continue;
      if (b.status !== "confirmed" && b.status !== "completed") continue;
      const bDate = new Date(b.date + "T00:00:00");
      const cur = lastBookingByClient.get(b.clientId);
      if (!cur || bDate > cur) lastBookingByClient.set(b.clientId, bDate);
    }
    for (const cl of allClients) {
      const last = lastBookingByClient.get(cl.id);
      if (last && last < cutoff) {
        alerts.push({
          id: `inactive-${cl.id}`,
          severity: "medium",
          title: `Cliente sem sessão · ${cl.name}`,
          detail: `Última sessão a ${amsDateOf(last)}`,
          link: "/clients",
        });
      }
    }

    const order: Record<Alert["severity"], number> = { high: 0, medium: 1, info: 2 };
    alerts.sort((a, b) => order[a.severity] - order[b.severity]);
    return c.json({ alerts: alerts.slice(0, 8) }, 200);
  });
