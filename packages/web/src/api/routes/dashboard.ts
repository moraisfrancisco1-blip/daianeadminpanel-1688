import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings, invoiceItems, services, payments } from "../database/schema";
import { requireAuth } from "../middleware/auth";
import { eq } from "drizzle-orm";
import { stripe } from "../services/stripe";
import Stripe from "stripe";

export const dashboardRoute = new Hono()
  .get("/stats", requireAuth, async (c) => {
    const allInvoices = await db.select().from(invoices);
    const allClients = await db.select().from(clients);
    const allBookings = await db.select().from(bookings);

    const now = new Date();
    const paid = allInvoices.filter((i) => i.status === "paid");
    const overdue = allInvoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.dueDate < now);
    const pending = allInvoices.filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.dueDate >= now);

    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const revenueThisMonth = paid.filter((i) => i.paidAt && i.paidAt >= thisMonth).reduce((s, i) => s + i.total, 0);

    return c.json(
      {
        totalClients: allClients.length,
        totalInvoices: allInvoices.length,
        paidCount: paid.length,
        overdueCount: overdue.length,
        pendingCount: pending.length,
        revenueThisMonth: Number(revenueThisMonth.toFixed(2)),
        outstandingTotal: Number([...overdue, ...pending].reduce((s, i) => s + i.total, 0).toFixed(2)),
        upcomingBookings: allBookings.filter(
          (b) => b.status === "confirmed" && b.date >= now.toISOString().slice(0, 10),
        ).length,
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
    const today = new Date().toISOString().slice(0, 10);
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
      const params: Stripe.BalanceTransactionListParams = {
        limit: 100,
        created: { gte: startTimestamp, lt: endTimestamp },
        type: "charge",
      };
      if (startingAfter) params.starting_after = startingAfter;

      const transactions = await stripe.balanceTransactions.list(params);

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
  });
