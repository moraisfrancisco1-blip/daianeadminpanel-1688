import { Hono } from "hono";
import { db } from "../database";
import { messageLog, clients } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

export const messagesRoute = new Hono()
  .get("/log", requireAuth, async (c) => {
    const rows = await db
      .select({
        id: messageLog.id,
        clientId: messageLog.clientId,
        clientName: clients.name,
        channel: messageLog.channel,
        recipient: messageLog.recipient,
        templateId: messageLog.templateId,
        body: messageLog.body,
        status: messageLog.status,
        error: messageLog.error,
        createdAt: messageLog.createdAt,
      })
      .from(messageLog)
      .leftJoin(clients, eq(messageLog.clientId, clients.id))
      .orderBy(desc(messageLog.createdAt))
      .limit(50);
    return c.json({ messages: rows }, 200);
  })
  .post("/log", requireAuth, async (c) => {
    const body = await c.req.json();
    const channel = typeof body.channel === "string" ? body.channel : "";
    const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
    const messageBody = typeof body.body === "string" ? body.body : "";
    if (!["whatsapp", "sms", "email"].includes(channel)) return c.json({ message: "Invalid channel" }, 400);
    if (!recipient || !messageBody) return c.json({ message: "recipient and body are required" }, 400);

    const [row] = await db
      .insert(messageLog)
      .values({
        clientId: body.clientId ?? null,
        channel,
        recipient,
        templateId: body.templateId ?? null,
        body: messageBody,
        status: body.status ?? "opened",
      })
      .returning();
    return c.json({ log: row }, 201);
  });
