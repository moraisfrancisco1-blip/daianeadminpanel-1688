import Twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

const client = accountSid && authToken ? Twilio(accountSid, authToken) : null;

export function normalizeE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/[\s().-]/g, "");
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  if (!normalized.startsWith("+")) return null;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return null;
  return normalized;
}

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  if (!client || !fromNumber) {
    throw new Error("SMS service is not configured");
  }

  const normalizedTo = normalizeE164(to);
  const normalizedFrom = normalizeE164(fromNumber);
  if (!normalizedTo) throw new Error("Invalid destination phone number");
  if (!normalizedFrom) throw new Error("Invalid Twilio phone number configuration");

  const message = body.trim();
  if (!message) throw new Error("Message cannot be empty");
  if (message.length > 1600) throw new Error("Message is too long");

  const result = await client.messages.create({
    from: normalizedFrom,
    to: normalizedTo,
    body: message,
  });

  return { sid: result.sid };
}
