import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings, invoiceItems, services } from "../database/schema";
import { requireAuth } from "../middleware/auth";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const reportsRoute = new Hono().get("/overview", requireAuth, async (c) => {
  const allInvoices = await db.select().from(invoices);
  const allClients = await db.select().from(clients);
  const allBookings = await db.select().from(bookings);
  const items = await db.select().from(invoiceItems);
  const allServices = await db.select().from(services);

  const now = new Date();
  const monthly: { month: string; label: string; billed: number; paid: number; pending: number; sessions: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthly.push({
      month: key,
      label: d.toLocaleString("en-GB", { month: "short", year: "2-digit" }),
      billed: 0,
      paid: 0,
      pending: 0,
      sessions: 0,
    });
  }
  const mMap = new Map(monthly.map((m) => [m.month, m]));

  for (const inv of allInvoices) {
    const key = ymd(inv.issueDate);
    const b = mMap.get(key);
    if (b) b.billed = Number((b.billed + inv.total).toFixed(2));
    if (inv.status === "paid") {
      const pk = inv.paidAt ? ymd(inv.paidAt) : key;
      const pb = mMap.get(pk);
      if (pb) pb.paid = Number((pb.paid + inv.total).toFixed(2));
    } else if (inv.status !== "cancelled") {
      if (b) b.pending = Number((b.pending + inv.total).toFixed(2));
    }
  }

  for (const bk of allBookings) {
    if (bk.status !== "confirmed" && bk.status !== "completed") continue;
    const b = mMap.get(bk.date.slice(0, 7));
    if (b) b.sessions++;
  }

  const serviceName = new Map(allServices.map((s) => [s.id, s.name]));
  const serviceRev = new Map<number, { name: string; revenue: number; count: number }>();
  for (const it of items) {
    if (it.serviceId == null) continue;
    const cur = serviceRev.get(it.serviceId) ?? { name: serviceName.get(it.serviceId) ?? "—", revenue: 0, count: 0 };
    cur.revenue = Number((cur.revenue + it.amount).toFixed(2));
    cur.count += it.quantity;
    serviceRev.set(it.serviceId, cur);
  }
  const topServices = [...serviceRev.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newClientsThisMonth = allClients.filter((cl) => cl.createdAt >= monthStart).length;
  const pending = allInvoices.filter((i) => i.status === "sent" || i.status === "overdue");

  return c.json(
    {
      monthly,
      topServices,
      totalClients: allClients.length,
      newClientsThisMonth,
      pendingCount: pending.length,
      pendingTotal: Number(pending.reduce((s, i) => s + i.total, 0).toFixed(2)),
    },
    200,
  );
});
