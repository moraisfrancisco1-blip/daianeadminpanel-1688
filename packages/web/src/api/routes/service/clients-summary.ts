import { Hono } from "hono";
import { db } from "../../database";
import { clients } from "../../database/schema";
import { requireServiceKey } from "../../middleware/service-key-auth";

/**
 * Read-only Volt Core service connector — Round 2 (Clients Summary).
 *
 * SECURITY MODEL — same discipline as routes/service/payment-control.ts,
 * enforced even more strictly here:
 * - `clients` holds name, email, phone, address, date of birth, and
 *   `clinicalNotes` (health information about real physiotherapy patients).
 *   NONE of that — or anything derived from it (age, city/country
 *   breakdowns small enough to re-identify someone at a small clinic) — is
 *   exposed here, or by any future change to this file. Two bare counts,
 *   nothing else.
 * - Only GET is wired up. Every other method on this exact path returns 403
 *   explicitly rather than relying on Hono's default 404.
 */
export const serviceClientsSummaryRoute = new Hono()
  .get("/", requireServiceKey, async (c) => {
    const rows = await db.select({ createdAt: clients.createdAt }).from(clients);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const newClientsLast30Days = rows.filter((r) => r.createdAt >= thirtyDaysAgo).length;

    return c.json(
      {
        summary: {
          totalClients: rows.length,
          newClientsLast30Days,
        },
      },
      200,
    );
  })
  // Explicit, tested rejection of every write method on this exact path —
  // not left to Hono's default 404 for an unregistered method/path pair.
  .on(["POST", "PUT", "PATCH", "DELETE"], "/", (c) => c.json({ message: "Forbidden — this connector is read-only" }, 403));
