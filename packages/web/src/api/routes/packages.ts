import { Hono } from "hono";
import { db } from "../database";
import { packages, packageUsages, clients } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

export const packagesRoute = new Hono()
  .get("/", requireAuth, async (c) => {
    const all = await db
      .select({
        id: packages.id,
        name: packages.name,
        clientId: packages.clientId,
        clientName: clients.name,
        totalSessions: packages.totalSessions,
        sessionsUsed: packages.sessionsUsed,
        price: packages.price,
        expiresAt: packages.expiresAt,
        purchasedAt: packages.purchasedAt,
        notes: packages.notes,
      })
      .from(packages)
      .leftJoin(clients, eq(packages.clientId, clients.id))
      .orderBy(desc(packages.purchasedAt));
    return c.json({ packages: all }, 200);
  })
  .get("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [pkg] = await db.select().from(packages).where(eq(packages.id, id));
    if (!pkg) return c.json({ message: "Not found" }, 404);
    const usages = await db
      .select()
      .from(packageUsages)
      .where(eq(packageUsages.packageId, id))
      .orderBy(desc(packageUsages.usedAt));
    return c.json({ package: pkg, usages }, 200);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json();
    if (!body.clientId || !body.name || !body.totalSessions) {
      return c.json({ message: "clientId, name and totalSessions are required" }, 400);
    }
    const [pkg] = await db
      .insert(packages)
      .values({
        clientId: body.clientId,
        name: body.name,
        totalSessions: body.totalSessions,
        price: body.price ?? 0,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        notes: body.notes ?? null,
      })
      .returning();
    return c.json({ package: pkg }, 201);
  })
  .put("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const [pkg] = await db
      .update(packages)
      .set({
        clientId: body.clientId,
        name: body.name,
        totalSessions: body.totalSessions,
        price: body.price,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        notes: body.notes ?? null,
      })
      .where(eq(packages.id, id))
      .returning();
    return c.json({ package: pkg }, 200);
  })
  .post("/:id/use", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [pkg] = await db.select().from(packages).where(eq(packages.id, id));
    if (!pkg) return c.json({ message: "Not found" }, 404);
    if (pkg.sessionsUsed >= pkg.totalSessions) {
      return c.json({ message: "Package has no remaining sessions" }, 400);
    }
    const [updated] = await db
      .update(packages)
      .set({ sessionsUsed: pkg.sessionsUsed + 1 })
      .where(eq(packages.id, id))
      .returning();
    await db.insert(packageUsages).values({ packageId: id, sessions: 1 });
    return c.json({ package: updated }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    await db.delete(packageUsages).where(eq(packageUsages.packageId, id));
    await db.delete(packages).where(eq(packages.id, id));
    return c.json({ success: true }, 200);
  });
