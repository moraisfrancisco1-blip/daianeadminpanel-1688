import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, bookings, invoiceItems, services, expenses } from "../database/schema";
import { requireAuth } from "../middleware/auth";
import { and, gte, lt, inArray, notInArray } from "drizzle-orm";
import { vatBreakdownFromNet, round2 } from "../lib/totals";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const reportsRoute = new Hono()
  .get("/vat-quarterly", requireAuth, async (c) => {
    const now = new Date();
    const year = Number(c.req.query("year") ?? now.getFullYear());
    const quarter = Number(c.req.query("quarter") ?? Math.floor(now.getMonth() / 3) + 1);
    if (quarter < 1 || quarter > 4) return c.json({ message: "quarter must be 1-4" }, 400);

    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 1);

    // VAT is owed once an invoice is issued/sent — draft invoices were never
    // sent (no VAT event yet) and cancelled ones negate the original event.
    const periodInvoices = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(gte(invoices.issueDate, start), lt(invoices.issueDate, end), notInArray(invoices.status, ["draft", "cancelled"])));

    const invoiceIds = periodInvoices.map((i) => i.id);
    const items = invoiceIds.length
      ? await db.select({ amount: invoiceItems.amount, vatRate: invoiceItems.vatRate }).from(invoiceItems).where(inArray(invoiceItems.invoiceId, invoiceIds))
      : [];

    const breakdown = vatBreakdownFromNet(items);
    const totalNet = round2(breakdown.reduce((s, b) => s + b.base, 0));
    const totalVat = round2(breakdown.reduce((s, b) => s + b.vat, 0));

    // Deductible input VAT: what the business paid on its own expenses this
    // quarter (Vodafone, domain, ads, etc.), which nets against VAT collected.
    const periodExpenses = await db
      .select()
      .from(expenses)
      .where(and(gte(expenses.issueDate, start), lt(expenses.issueDate, end)));
    const expenseBreakdown = vatBreakdownFromNet(periodExpenses.map((e) => ({ amount: e.netAmount, vatRate: e.vatRate })));
    const expensesNet = round2(expenseBreakdown.reduce((s, b) => s + b.base, 0));
    const expensesVat = round2(expenseBreakdown.reduce((s, b) => s + b.vat, 0));

    return c.json(
      {
        year,
        quarter,
        label: `Q${quarter} ${year}`,
        invoiceCount: invoiceIds.length,
        breakdown: breakdown.sort((a, b) => b.rate - a.rate),
        totalNet,
        totalVat,
        totalGross: round2(totalNet + totalVat),
        expenseCount: periodExpenses.length,
        expenseBreakdown: expenseBreakdown.sort((a, b) => b.rate - a.rate),
        expensesNet,
        expensesVat,
        vatPayable: round2(totalVat - expensesVat),
      },
      200,
    );
  })
  .get("/overview", requireAuth, async (c) => {
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
