import { db } from "../database";
import { stripeWebhookEvents } from "../database/schema";
import { eq } from "drizzle-orm";

/**
 * How long an event may sit in "processing" before it is considered stale
 * (the process crashed mid-flight) and can be safely reclaimed on a retry.
 * Stripe's first webhook retries arrive after ~1 minute, so 5 minutes is a
 * safe window that never collides with a genuinely slow in-flight attempt.
 */
const PROCESSING_STALE_MS = 5 * 60 * 1000;

export type WebhookClaim = "process" | "skip";

/**
 * Claims a Stripe webhook event for processing using a persistent state machine:
 *
 *   (new)       -> processing   (claim)
 *   processing  -> processed    (success — terminal, never reprocessed)
 *   processing  -> failed       (failure — retried on next Stripe delivery)
 *   failed      -> processing   (retry)
 *   processing  -> processing   (stale reclaim after a crash)
 *
 * Returns "process" when the caller should run the event, and "skip" when the
 * event has already been fully processed (or is currently being processed
 * elsewhere). The state is stored in the database, so it survives restarts.
 *
 * Fails open (returns "process") on unexpected DB errors so an event is never
 * silently dropped.
 */
export async function claimWebhookEvent(eventId: string, type: string): Promise<WebhookClaim> {
  try {
    const existing = await db
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.id, eventId));
    const row = existing[0];

    if (!row) {
      await db
        .insert(stripeWebhookEvents)
        .values({ id: eventId, type, status: "processing", attempts: 1, updatedAt: new Date() })
        .onConflictDoNothing();
      return "process";
    }

    if (row.status === "processed") {
      return "skip";
    }

    if (row.status === "failed") {
      await db
        .update(stripeWebhookEvents)
        .set({ status: "processing", attempts: row.attempts + 1, lastError: null, updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.id, eventId));
      return "process";
    }

    // status === "processing"
    const isStale = Date.now() - row.updatedAt.getTime() > PROCESSING_STALE_MS;
    if (isStale) {
      await db
        .update(stripeWebhookEvents)
        .set({ status: "processing", attempts: row.attempts + 1, updatedAt: new Date() })
        .where(eq(stripeWebhookEvents.id, eventId));
      return "process";
    }

    return "skip";
  } catch (error) {
    console.error("[webhook-idempotency] Failed to claim event (failing open):", error);
    return "process";
  }
}

export async function markWebhookEventProcessed(eventId: string): Promise<void> {
  try {
    await db
      .update(stripeWebhookEvents)
      .set({ status: "processed", updatedAt: new Date() })
      .where(eq(stripeWebhookEvents.id, eventId));
  } catch (error) {
    console.error("[webhook-idempotency] Failed to mark event processed:", error);
  }
}

export async function markWebhookEventFailed(eventId: string, error: string): Promise<void> {
  try {
    await db
      .update(stripeWebhookEvents)
      .set({ status: "failed", lastError: error, updatedAt: new Date() })
      .where(eq(stripeWebhookEvents.id, eventId));
  } catch (err) {
    console.error("[webhook-idempotency] Failed to mark event failed:", err);
  }
}
