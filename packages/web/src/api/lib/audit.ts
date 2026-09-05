import { db } from "../database";
import { auditLog } from "../database/schema";
import type { Context } from "hono";

type AuditUser = { id?: string | null; email?: string | null } | null | undefined;

/**
 * Records an admin action for the audit trail. Never throws — a logging
 * failure should never block the actual operation (same principle as
 * email-log's logEmailRow).
 */
export async function recordAudit(opts: {
  actor: AuditUser;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorUserId: opts.actor?.id ?? null,
      actorEmail: opts.actor?.email ?? null,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    });
  } catch (err) {
    console.error("[audit] Failed to write audit log:", err);
  }
}

/** Pulls the actor {id, email} off a Hono context set by authMiddleware. */
export function actorFromContext(c: Context): AuditUser {
  const user = c.get("user") as { id?: string; email?: string } | null | undefined;
  return user ? { id: user.id, email: user.email } : null;
}
