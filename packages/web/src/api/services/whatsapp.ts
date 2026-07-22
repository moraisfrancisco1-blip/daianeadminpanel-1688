import Twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
const adminNumber = process.env.DAIANE_PHONE_NUMBER;

const client = accountSid && authToken ? Twilio(accountSid, authToken) : null;

function normalizeWhatsAppAddress(raw: string): string {
  const trimmed = raw.trim();
  const withoutPrefix = trimmed.startsWith("whatsapp:") ? trimmed.slice("whatsapp:".length) : trimmed;
  // Twilio requires E.164 (no spaces/dashes/parentheses) — strip everything except a leading +.
  const digitsOnly = withoutPrefix.replace(/[^\d+]/g, "");
  return `whatsapp:${digitsOnly}`;
}

/**
 * Sends a WhatsApp message to Daiane's own number via Twilio. Best-effort — never throws,
 * so a WhatsApp/Twilio outage never blocks a booking confirmation.
 */
export async function sendAdminWhatsApp(message: string): Promise<{ sent: boolean; error?: string }> {
  if (!client || !fromNumber || !adminNumber) {
    console.warn("[whatsapp] Twilio not fully configured — skipping WhatsApp notification");
    return { sent: false, error: "not_configured" };
  }

  try {
    await client.messages.create({
      from: normalizeWhatsAppAddress(fromNumber),
      to: normalizeWhatsAppAddress(adminNumber),
      body: message,
    });
    return { sent: true };
  } catch (err) {
    console.error("[whatsapp] Failed to send WhatsApp notification:", err);
    return { sent: false, error: err instanceof Error ? err.message : "unknown_error" };
  }
}

export function buildBookingWhatsAppMessage(opts: {
  clientName: string;
  clientPhone?: string | null;
  serviceName: string;
  date: string;
  startTime: string;
  amount: number;
  payFullNow: boolean;
}): string {
  const paymentLine =
    opts.amount === 0
      ? "Free session — no payment required."
      : `${opts.payFullNow ? "Paid in full" : "Deposit paid"}: €${opts.amount.toFixed(2)}`;

  return [
    "📅 *New booking confirmed*",
    "",
    `*Client:* ${opts.clientName}`,
    opts.clientPhone ? `*Phone:* ${opts.clientPhone}` : null,
    `*Service:* ${opts.serviceName}`,
    `*Date:* ${opts.date} at ${opts.startTime}`,
    paymentLine,
  ]
    .filter(Boolean)
    .join("\n");
}
