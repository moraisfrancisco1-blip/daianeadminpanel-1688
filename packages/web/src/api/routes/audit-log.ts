import { Hono } from "hono";
import { db } from "../database";
import { auditLog } from "../database/schema";
import { requireAuth } from "../middleware/auth";
import { desc, sql } from "drizzle-orm";

export const auditLogRoute = new Hono().get("/", requireAuth, async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") ?? 50)));

  const [totalRow] = await db.select({ n: sql<number>`count(*)` }).from(auditLog);
  const total = Number(totalRow?.n ?? 0);

  const rows = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ entries: rows, total, page, pageSize }, 200);
});
