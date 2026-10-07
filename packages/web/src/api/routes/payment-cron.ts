import { Hono } from "hono";
import { runPaymentVerification } from "../services/payment-reconcile";

// Scheduled payment verification — no admin session exists for a cron request, so it is
// authenticated by the shared CRON_SECRET (Vercel Cron sends "Authorization: Bearer <CRON_SECRET>";
// an external scheduler can send the same header). Kept outside /payment-control, which is admin-only.
export const paymentCronRoute = new Hono().get("/verify", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return c.json({ message: "CRON_SECRET is not configured" }, 501);
  if (c.req.header("authorization") !== `Bearer ${secret}`) return c.json({ message: "Unauthorized" }, 401);
  return c.json(await runPaymentVerification(), 200);
});
