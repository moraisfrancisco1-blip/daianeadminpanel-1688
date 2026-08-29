import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { normalizeE164, sendSms } from "../services/sms";

export const smsRoute = new Hono().post("/send", requireAuth, async (c) => {
  const payload = await c.req.json<{ to?: string; message?: string }>();
  const to = typeof payload.to === "string" ? normalizeE164(payload.to) : null;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";

  if (!to) return c.json({ message: "Invalid phone number. Use international E.164 format." }, 400);
  if (!message) return c.json({ message: "Message cannot be empty." }, 400);
  if (message.length > 1600) return c.json({ message: "Message is too long." }, 400);

  try {
    const result = await sendSms(to, message);
    console.info("[sms] sent", { to, sid: result.sid });
    return c.json({ success: true, messageSid: result.sid }, 200);
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown SMS provider error";
    console.error("[sms] failed", { to, error: details });
    return c.json({ message: "Failed to send SMS", details }, 502);
  }
});
