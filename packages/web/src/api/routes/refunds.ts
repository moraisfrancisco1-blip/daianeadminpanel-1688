import { Hono } from "hono";
import { db } from "../database";
import { refunds, invoices, clients, payments } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

export const refundsRoute = new Hono().get("/", requireAuth, async (c) => {
  const all = await db
    .select({
      id: refunds.id,
      invoiceId: refunds.invoiceId,
      paymentId: refunds.paymentId,
      amount: refunds.amount,
      reason: refunds.reason,
      status: refunds.status,
      stripeRefundId: refunds.stripeRefundId,
      createdAt: refunds.createdAt,
      invoiceNumber: invoices.invoiceNumber,
      invoiceTotal: invoices.total,
      clientId: invoices.clientId,
      clientName: clients.name,
      clientEmail: clients.email,
      paymentMethod: payments.method,
      paymentPaidAt: payments.paidAt,
    })
    .from(refunds)
    .leftJoin(invoices, eq(refunds.invoiceId, invoices.id))
    .leftJoin(clients, eq(invoices.clientId, clients.id))
    .leftJoin(payments, eq(refunds.paymentId, payments.id))
    .orderBy(desc(refunds.createdAt));

  const succeeded = all.filter((r) => r.status === "succeeded");
  const totalRefunded = Number(succeeded.reduce((s, r) => s + r.amount, 0).toFixed(2));

  return c.json(
    {
      refunds: all,
      summary: { count: all.length, succeededCount: succeeded.length, totalRefunded },
    },
    200,
  );
});
