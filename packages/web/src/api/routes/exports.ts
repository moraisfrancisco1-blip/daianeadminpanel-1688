import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients, refunds, expenses } from "../database/schema";
import { eq, and, gte, lt, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { generateMonthlyExcel } from "../lib/excel-export";

async function buildInvoiceExcel(start: Date, end: Date, label: string, includeExpenses = false) {
  const rows = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      clientName: clients.name,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      subtotal: invoices.subtotal,
      vatTotal: invoices.vatTotal,
      total: invoices.total,
      status: invoices.status,
      paidAt: invoices.paidAt,
    })
    .from(invoices)
    .leftJoin(clients, eq(invoices.clientId, clients.id))
    .where(and(gte(invoices.issueDate, start), lt(invoices.issueDate, end)));

  const invoiceIds = rows.map((r) => r.invoiceId);
  const periodRefunds = invoiceIds.length
    ? await db.select().from(refunds).where(inArray(refunds.invoiceId, invoiceIds))
    : [];
  const refundedByInvoice = new Map<number, number>();
  for (const r of periodRefunds) {
    if (r.status !== "succeeded") continue;
    refundedByInvoice.set(r.invoiceId, (refundedByInvoice.get(r.invoiceId) ?? 0) + r.amount);
  }
  const invoiceById = new Map(rows.map((r) => [r.invoiceId, r]));

  const expenseRows = includeExpenses
    ? (await db.select().from(expenses).where(and(gte(expenses.issueDate, start), lt(expenses.issueDate, end)))).map((e) => ({
        supplier: e.supplier,
        category: e.category,
        invoiceNumber: e.invoiceNumber,
        issueDate: e.issueDate,
        netAmount: e.netAmount,
        vatAmount: e.vatAmount,
        totalAmount: e.totalAmount,
        attachmentUrl: e.attachmentUrl,
      }))
    : undefined;

  return generateMonthlyExcel(
    rows.map((r) => ({
      ...r,
      clientName: r.clientName ?? "Unknown",
      refundedAmount: refundedByInvoice.get(r.invoiceId) ?? 0,
    })),
    periodRefunds.map((r) => ({
      invoiceNumber: invoiceById.get(r.invoiceId)?.invoiceNumber ?? `#${r.invoiceId}`,
      clientName: invoiceById.get(r.invoiceId)?.clientName ?? "Unknown",
      amount: r.amount,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
    })),
    label,
    expenseRows,
  );
}

export const exportsRoute = new Hono()
  .get("/monthly", requireAuth, async (c) => {
    const year = Number(c.req.query("year") ?? new Date().getFullYear());
    const month = Number(c.req.query("month") ?? new Date().getMonth() + 1); // 1-12

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const monthLabel = `${start.toLocaleString("en-GB", { month: "long" })} ${year}`;
    const buffer = await buildInvoiceExcel(start, end, monthLabel);

    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    c.header("Content-Disposition", `attachment; filename="invoices-${year}-${String(month).padStart(2, "0")}.xlsx"`);
    return c.body(new Uint8Array(buffer));
  })
  .get("/quarterly", requireAuth, async (c) => {
    const year = Number(c.req.query("year") ?? new Date().getFullYear());
    const quarter = Number(c.req.query("quarter") ?? Math.floor(new Date().getMonth() / 3) + 1); // 1-4
    if (quarter < 1 || quarter > 4) return c.json({ message: "quarter must be 1-4" }, 400);

    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 1);
    const label = `Q${quarter} ${year}`;
    const buffer = await buildInvoiceExcel(start, end, label, true);

    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    c.header("Content-Disposition", `attachment; filename="invoices-${year}-Q${quarter}.xlsx"`);
    return c.body(new Uint8Array(buffer));
  });
