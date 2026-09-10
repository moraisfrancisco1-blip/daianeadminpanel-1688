import { Hono } from "hono";
import { db } from "../../database";
import { bookings } from "../../database/schema";
import { requireServiceKey } from "../../middleware/service-key-auth";

/**
 * Read-only Volt Core service connector — Round 2 (Bookings Summary).
 *
 * SECURITY MODEL — same discipline as routes/service/payment-control.ts:
 * - Allowlist, not denylist. Every field this endpoint reads and returns is
 *   named explicitly below; nothing from `bookings` is ever spread or
 *   passed through wholesale.
 * - No client name, email, phone, or notes — `bookings` holds identifiable
 *   contact details for real physiotherapy clients and this endpoint must
 *   never become a way to enumerate or profile them. Aggregate counts only,
 *   no per-booking rows are ever returned.
 * - Only GET is wired up. Every other method on this exact path returns 403
 *   explicitly rather than relying on Hono's default 404.
 */
export const serviceBookingsSummaryRoute = new Hono()
  .get("/", requireServiceKey, async (c) => {
    const rows = await db
      .select({
        date: bookings.date,
        location: bookings.location,
        status: bookings.status,
        depositStatus: bookings.depositStatus,
      })
      .from(bookings);

    // Server-local date math, same YYYY-MM-DD string shape the `date` column
    // already uses — avoids pulling in a date library for a same-day/7-day window.
    const today = new Date().toISOString().slice(0, 10);
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const byStatus: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    const byDepositStatus: Record<string, number> = {};
    let todayCount = 0;
    let next7DaysCount = 0;

    for (const b of rows) {
      byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
      byLocation[b.location] = (byLocation[b.location] ?? 0) + 1;
      byDepositStatus[b.depositStatus] = (byDepositStatus[b.depositStatus] ?? 0) + 1;
      if (b.date === today) todayCount++;
      if (b.date >= today && b.date <= in7Days) next7DaysCount++;
    }

    return c.json(
      {
        summary: {
          totalBookings: rows.length,
          todayCount,
          next7DaysCount,
          byStatus,
          byLocation,
          byDepositStatus,
        },
      },
      200,
    );
  })
  // Explicit, tested rejection of every write method on this exact path —
  // not left to Hono's default 404 for an unregistered method/path pair.
  .on(["POST", "PUT", "PATCH", "DELETE"], "/", (c) => c.json({ message: "Forbidden — this connector is read-only" }, 403));
