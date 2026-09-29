const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

// Loaded lazily (rather than imported at the top) so nothing pulls in Twilio's
// axios/follow-redirects chain — and their heavier startup cost — for requests
// that never send an SMS.
let clientPromise: Promise<import("twilio").Twilio | null> | null = null;
function getClient() {
  if (!accountSid || !authToken) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("twilio").then((m) => (m.default ?? m)(accountSid, authToken));
  }
  return clientPromise;
}

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
  const client = await getClient();
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
