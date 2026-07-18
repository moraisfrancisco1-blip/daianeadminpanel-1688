import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer }[];
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail({ to, subject, text, html, replyTo, attachments }: SendEmailOptions) {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping send:", subject);
    return { skipped: true };
  }
  const { data, error } = await resend.emails.send({
    from: "Studio Daï Oakes <admin@studiodaioakes.com>",
    to: Array.isArray(to) ? to : [to],
    subject,
    // Always include a plain-text version alongside HTML — improves spam filter
    // scoring (multipart emails are trusted more than HTML-only).
    text: text ?? (html ? htmlToPlainText(html) : undefined),
    html,
    replyTo,
    attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });

  if (error) throw new Error(`Email failed: ${error.message}`);
  return data;
}
