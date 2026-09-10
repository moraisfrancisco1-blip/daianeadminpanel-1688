import { Hono } from "hono";
import { db } from "../../database";
import { stripeWebhookEvents, emailLog, messageLog, auditLog, rateLimitHits } from "../../database/schema";
import { requireServiceKey } from "../../middleware/service-key-auth";

/**
 * Read-only Volt Core service connector — Round 2 (System Health).
 *
 * SECURITY MODEL — same discipline as routes/service/payment-control.ts:
 * - Purely operational counts (webhook processing, email/message delivery,
 *   admin-action volume, rate-limit hits). No recipient, no actor identity,
 *   no free-text (error messages, email subjects, audit metadata) is ever
 *   returned — those fields can carry a client's name or email even on a
 *   table that isn't "about" clients (e.g. emailLog.subject, auditLog.metadata).
 * - Only GET is wired up. Every other method on this exact path returns 403
 *   explicitly rather than relying on Hono's default 404.
 */
export const serviceSystemHealthRoute = new Hono()
  .get("/", requireServiceKey, async (c) => {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const webhooks = await db
      .select({ status: stripeWebhookEvents.status, updatedAt: stripeWebhookEvents.updatedAt })
      .from(stripeWebhookEvents);
    const emails = await db.select({ status: emailLog.status, createdAt: emailLog.createdAt }).from(emailLog);
    const messages = await db
      .select({ status: messageLog.status, createdAt: messageLog.createdAt })
      .from(messageLog);
    const audits = await db.select({ createdAt: auditLog.createdAt }).from(auditLog);
    const rateLimits = await db.select({ key: rateLimitHits.key, createdAt: rateLimitHits.createdAt }).from(rateLimitHits);

    const count = <T,>(arr: T[], pred: (x: T) => boolean) => arr.filter(pred).length;

    return c.json(
      {
        summary: {
          webhooks: {
            failedTotal: count(webhooks, (w) => w.status === "failed"),
            processedTotal: count(webhooks, (w) => w.status === "processed"),
            failedLast24h: count(webhooks, (w) => w.status === "failed" && w.updatedAt >= last24h),
          },
          emails: {
            sentLast24h: count(emails, (e) => e.status === "sent" && e.createdAt >= last24h),
            failedLast24h: count(emails, (e) => e.status === "failed" && e.createdAt >= last24h),
          },
          messages: {
            sentLast24h: count(messages, (m) => m.status === "sent" && m.createdAt >= last24h),
            failedLast24h: count(messages, (m) => m.status === "failed" && m.createdAt >= last24h),
          },
          adminActionsLast24h: count(audits, (a) => a.createdAt >= last24h),
          loginRateLimitHitsLast24h: count(rateLimits, (r) => r.key.startsWith("login:") && r.createdAt >= last24h),
        },
      },
      200,
    );
  })
  // Explicit, tested rejection of every write method on this exact path —
  // not left to Hono's default 404 for an unregistered method/path pair.
  .on(["POST", "PUT", "PATCH", "DELETE"], "/", (c) => c.json({ message: "Forbidden — this connector is read-only" }, 403));
