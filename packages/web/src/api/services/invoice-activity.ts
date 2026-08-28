import { db } from "../database";
import { invoices, invoiceActivity } from "../database/schema";
import { eq } from "drizzle-orm";

export type ActivityChannel = "admin" | "stripe" | "manual" | "email" | "system";

export type ActivityInput = {
  invoiceId: number;
  type: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  channel?: ActivityChannel | string;
  recipientEmail?: string | null;
  amount?: number | null;
  method?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Appends one row to invoice_activity. Never throws (best-effort audit trail).
 */
export async function recordInvoiceActivity(input: ActivityInput): Promise<void> {
  try {
    await db.insert(invoiceActivity).values({
      invoiceId: input.invoiceId,
      type: input.type,
      oldStatus: input.oldStatus ?? null,
      newStatus: input.newStatus ?? null,
      channel: input.channel ?? "system",
      recipientEmail: input.recipientEmail ?? null,
      amount: input.amount ?? null,
      method: input.method ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
  } catch (err) {
    console.error("[invoice-activity] Failed to record activity:", err);
  }
}

/**
 * Central, idempotent status transition for an invoice.
 * - Fetches the current status.
 * - Only writes when the status actually changes.
 * - Updates paidAt when applicable.
 * - Records a status_changed (or passed type) event in the audit trail.
 *
 * Returns { changed, oldStatus, newStatus }.
 */
export async function changeInvoiceStatus(
  invoiceId: number,
  newStatus: string,
  opts: {
    channel?: ActivityChannel | string;
    paidAt?: Date | null;
    type?: string;
    metadata?: Record<string, unknown> | null;
  } = {},
): Promise<{ changed: boolean; oldStatus: string; newStatus: string }> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return { changed: false, oldStatus: newStatus, newStatus };

  if (inv.status === newStatus) {
    return { changed: false, oldStatus: inv.status, newStatus };
  }

  const oldStatus = inv.status;
  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === "paid") {
    updateData.paidAt = opts.paidAt ?? new Date();
  } else {
    updateData.paidAt = null;
  }

  await db.update(invoices).set(updateData).where(eq(invoices.id, invoiceId));

  await recordInvoiceActivity({
    invoiceId,
    type: opts.type ?? "status_changed",
    oldStatus,
    newStatus,
    channel: opts.channel ?? "system",
    amount: newStatus === "paid" ? inv.total : null,
    metadata: opts.metadata,
  });

  return { changed: true, oldStatus, newStatus };
}
