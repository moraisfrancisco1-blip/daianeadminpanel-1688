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

  const recipients = Array.isArray(to) ? to : [to];
  const attachmentPayload = attachments?.map((a) => ({ filename: a.filename, content: a.content }));

  // Resend requires react, html, or text to be present (its type only accepts an
  // object literal where at least one of those is a definite string) — branch
  // explicitly instead of passing possibly-undefined html/text through, which
  // both satisfies the type and matches the API's actual runtime requirement.
  const { data, error } = html
    ? await resend.emails.send({
        from: "Studio Daï Oakes <admin@studiodaioakes.com>",
        to: recipients,
        subject,
        html,
        // Always include a plain-text version alongside HTML — improves spam filter
        // scoring (multipart emails are trusted more than HTML-only).
        text: text ?? htmlToPlainText(html),
        replyTo,
        attachments: attachmentPayload,
      })
    : text
      ? await resend.emails.send({
          from: "Studio Daï Oakes <admin@studiodaioakes.com>",
          to: recipients,
          subject,
          text,
          replyTo,
          attachments: attachmentPayload,
        })
      : (() => {
          throw new Error(`Email failed: no content provided (subject: ${subject})`);
        })();

  if (error) throw new Error(`Email failed: ${error.message}`);
  return data;
}
