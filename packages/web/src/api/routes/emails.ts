import { Hono } from "hono";
import { db } from "../database";
import { emailLog, invoices, clients } from "../database/schema";
import { requireAuth } from "../middleware/auth";
import { and, or, like, eq, desc, gte, lte, sql } from "drizzle-orm";

export const emailsRoute = new Hono()
  .get("/", requireAuth, async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const type = c.req.query("type");
    const status = c.req.query("status");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 25)));

    const conds: any[] = [];
    if (q) {
      const likeQ = `%${q}%`;
      const parts: any[] = [
        like(emailLog.recipientEmail, likeQ),
        like(emailLog.recipientName, likeQ),
        like(invoices.invoiceNumber, likeQ),
      ];
      if (/^\d+$/.test(q)) parts.push(eq(emailLog.bookingId, Number(q)));
      conds.push(or(...parts));
    }
    if (type && type !== "all") conds.push(eq(emailLog.type, type));
    if (status && status !== "all") conds.push(eq(emailLog.status, status));
    if (from) conds.push(gte(emailLog.createdAt, new Date(`${from}T00:00:00Z`)));
    if (to) conds.push(lte(emailLog.createdAt, new Date(`${to}T23:59:59Z`)));

    const where = conds.length ? and(...conds) : undefined;

    const [totalRow] = await db
      .select({ n: sql<number>`count(*)` })
      .from(emailLog)
      .leftJoin(invoices, eq(emailLog.invoiceId, invoices.id))
      .where(where);
    const total = Number(totalRow?.n ?? 0);

    const rows = await db
      .select({
        id: emailLog.id,
        createdAt: emailLog.createdAt,
        clientId: emailLog.clientId,
        invoiceId: emailLog.invoiceId,
        bookingId: emailLog.bookingId,
        recipientEmail: emailLog.recipientEmail,
        recipientName: emailLog.recipientName,
        type: emailLog.type,
        subject: emailLog.subject,
        status: emailLog.status,
        providerMessageId: emailLog.providerMessageId,
        error: emailLog.error,
        provider: emailLog.provider,
        source: emailLog.source,
        invoiceNumber: invoices.invoiceNumber,
        clientName: clients.name,
      })
      .from(emailLog)
      .leftJoin(invoices, eq(emailLog.invoiceId, invoices.id))
      .leftJoin(clients, eq(emailLog.clientId, clients.id))
      .where(where)
      .orderBy(desc(emailLog.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return c.json({ emails: rows, total, page, pageSize }, 200);
  });
