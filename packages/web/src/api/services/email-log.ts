import { db } from "../database";
import { emailLog } from "../database/schema";
import { sendEmail } from "./email";

export type EmailType =
  | "invoice"
  | "payment_link"
  | "booking_confirmation"
  | "reminder"
  | "cancellation"
  | "quote"
  | "package"
  | "other";

export type TrackedEmailOptions = {
  to: string;
  recipientName?: string | null;
  clientId?: number | null;
  invoiceId?: number | null;
  bookingId?: number | null;
  type?: EmailType | string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer }[];
};

async function logEmailRow(
  opts: TrackedEmailOptions,
  status: "sent" | "failed",
  extra: { providerMessageId?: string | null; error?: string | null },
): Promise<void> {
  try {
    await db.insert(emailLog).values({
      clientId: opts.clientId ?? null,
      invoiceId: opts.invoiceId ?? null,
      bookingId: opts.bookingId ?? null,
      recipientEmail: opts.to,
      recipientName: opts.recipientName ?? null,
      type: opts.type,
      subject: opts.subject,
      status,
      providerMessageId: extra.providerMessageId ?? null,
      error: extra.error ?? null,
      provider: "resend",
    });
  } catch (err) {
    console.error("[email-log] Failed to write email log:", err);
  }
}

/**
 * Sends an email through the configured provider and records the outcome in email_log.
 * - "sent" is only written when the provider actually accepted the send.
 * - On provider error the log is written as "failed" and the error is re-thrown so the
 *   caller never marks an invoice as sent when the email did not go out.
 * - If the provider is not configured, it is recorded as "failed" (not silently "sent").
 */
export async function sendTrackedEmail(opts: TrackedEmailOptions): Promise<{ skipped?: boolean } | unknown> {
  try {
    const result: any = await sendEmail({
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      replyTo: opts.replyTo,
      attachments: opts.attachments,
    });

    if (result?.skipped) {
      await logEmailRow(opts, "failed", { error: "Provider not configured (RESEND_API_KEY missing)" });
      return result;
    }

    await logEmailRow(opts, "sent", { providerMessageId: result?.id ?? null });
    return result;
  } catch (err: any) {
    await logEmailRow(opts, "failed", { error: err?.message ?? String(err) });
    throw err;
  }
}

/** Records an email that was sent through an external/legacy path (or a failed attempt). */
export async function logEmailRowExternal(
  opts: TrackedEmailOptions,
  status: "sent" | "failed",
  extra: { providerMessageId?: string | null; error?: string | null } = {},
): Promise<void> {
  await logEmailRow(opts, status, extra);
}
