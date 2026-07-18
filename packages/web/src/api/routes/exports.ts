import { Hono } from "hono";
import { db } from "../database";
import { invoices, clients } from "../database/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { generateMonthlyExcel } from "../lib/excel-export";

export const exportsRoute = new Hono().get("/monthly", requireAuth, async (c) => {
  const year = Number(c.req.query("year") ?? new Date().getFullYear());
  const month = Number(c.req.query("month") ?? new Date().getMonth() + 1); // 1-12

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const rows = await db
    .select({
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

  const monthLabel = `${start.toLocaleString("en-GB", { month: "long" })} ${year}`;
  const buffer = await generateMonthlyExcel(
    rows.map((r) => ({ ...r, clientName: r.clientName ?? "Unknown" })),
    monthLabel,
  );

  c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  c.header("Content-Disposition", `attachment; filename="invoices-${year}-${String(month).padStart(2, "0")}.xlsx"`);
  return c.body(new Uint8Array(buffer));
});
