import { Hono } from "hono";
import { db } from "../database";
import { services } from "../database/schema";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { recordAudit, actorFromContext } from "../lib/audit";

export const servicesRoute = new Hono()
  .get("/", async (c) => {
    const activeOnly = c.req.query("active");
    const all = await db.select().from(services).orderBy(asc(services.sortOrder), asc(services.id));
    const filtered = activeOnly === "true" ? all.filter((s) => s.active) : all;
    return c.json({ services: filtered }, 200);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json();
    const [service] = await db
      .insert(services)
      .values({
        name: body.name,
        groupLabel: body.groupLabel ?? null,
        description: body.description ?? null,
        durationMinutes: body.durationMinutes ?? 60,
        price: body.price,
        vatRate: body.vatRate ?? 0.09,
        active: body.active ?? true,
        sortOrder: body.sortOrder ?? 0,
      })
      .returning();
    return c.json({ service }, 201);
  })
  .put("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const [existing] = await db.select().from(services).where(eq(services.id, id));
    const [service] = await db
      .update(services)
      .set({
        name: body.name,
        groupLabel: body.groupLabel ?? null,
        description: body.description ?? null,
        durationMinutes: body.durationMinutes,
        price: body.price,
        vatRate: body.vatRate,
        active: body.active,
        sortOrder: body.sortOrder,
      })
      .where(eq(services.id, id))
      .returning();
    if (existing && service && (existing.price !== service.price || existing.vatRate !== service.vatRate)) {
      await recordAudit({
        actor: actorFromContext(c),
        action: "price_changed",
        entityType: "service",
        entityId: id,
        metadata: { name: service.name, oldPrice: existing.price, newPrice: service.price, oldVatRate: existing.vatRate, newVatRate: service.vatRate },
      });
    }
    return c.json({ service }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [existing] = await db.select().from(services).where(eq(services.id, id));
    await db.delete(services).where(eq(services.id, id));
    await recordAudit({
      actor: actorFromContext(c),
      action: "deleted",
      entityType: "service",
      entityId: id,
      metadata: existing ? { name: existing.name, price: existing.price } : undefined,
    });
    return c.json({ success: true }, 200);
  });
