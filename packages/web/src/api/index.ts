import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { authMiddleware, requireAdmin } from "./middleware/auth";
import { clientsRoute } from "./routes/clients";
import { servicesRoute } from "./routes/services";
import { quotesRoute } from "./routes/quotes";
import { invoicesRoute } from "./routes/invoices";
import { bookingsRoute } from "./routes/bookings";
import { remindersRoute } from "./routes/reminders";
import { exportsRoute } from "./routes/exports";
import { dashboardRoute } from "./routes/dashboard";
import { googleCalendarRoute } from "./routes/google-calendar";
import { stripeWebhookRoute } from "./routes/stripe-webhook";
import { reportsRoute } from "./routes/reports";
import { packagesRoute } from "./routes/packages";
import { emailsRoute } from "./routes/emails";
import { paymentControlRoute } from "./routes/payment-control";
import { refundsRoute } from "./routes/refunds";
import { messagesRoute } from "./routes/messages";
import { addressLookupRoute } from "./routes/address-lookup";
import { smsRoute } from "./routes/sms";
import { settingsRoute } from "./routes/settings";
import { auditLogRoute } from "./routes/audit-log";
import { expensesRoute } from "./routes/expenses";
import { reportVoltWatchEvent } from "./services/volt-watch";
import { rateLimitByIp } from "./lib/rate-limit";

const app = new Hono()
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }))
  // Public health endpoint used by VOLT CORE uptime monitoring. No customer data is exposed.
  .get("/api/health", (c) => c.json({ status: "ok", service: "daiane-oakes-admin" }, 200))
  // Brute-force protection on the only login path into financial/health data —
  // 10 attempts per 15 minutes per IP, regardless of outcome.
  .use("/api/auth/sign-in/*", rateLimitByIp({ method: "POST", prefix: "login", limit: 10, windowMs: 15 * 60 * 1000 }))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  // Stripe webhook must be registered BEFORE auth middleware (no auth required)
  .route("/api/stripe-webhook", stripeWebhookRoute)
  // The public booking form has no login gate, so cap creates per IP —
  // 20 per hour is generous for a real client, tight for a spam script.
  .use("/api/bookings", rateLimitByIp({ method: "POST", prefix: "public-booking", limit: 20, windowMs: 60 * 60 * 1000 }))
  .basePath("api")
  .use("*", authMiddleware)
  // Financial/settings routes are admin-only — a "staff" account (e.g. an
  // assistant or another therapist) can run day-to-day operations (clients,
  // calendar, bookings, packages, messages) but not see money or change config.
  // Both the exact base path and its subpaths are registered — Hono's "/x/*"
  // wildcard does not match the bare "/x" with no trailing segment.
  .use("/invoices", requireAdmin)
  .use("/invoices/*", requireAdmin)
  .use("/quotes", requireAdmin)
  .use("/quotes/*", requireAdmin)
  .use("/payment-control", requireAdmin)
  .use("/payment-control/*", requireAdmin)
  .use("/refunds", requireAdmin)
  .use("/refunds/*", requireAdmin)
  .use("/expenses", requireAdmin)
  .use("/expenses/*", requireAdmin)
  .use("/exports", requireAdmin)
  .use("/exports/*", requireAdmin)
  .use("/reports", requireAdmin)
  .use("/reports/*", requireAdmin)
  .use("/settings", requireAdmin)
  .use("/settings/*", requireAdmin)
  .use("/audit-log", requireAdmin)
  .use("/audit-log/*", requireAdmin)
  .onError((err, c) => {
    console.error("[api error]", err);
    reportVoltWatchEvent({
      severity: "high",
      eventType: "api_error",
      title: "Admin API error",
      message: err instanceof Error ? err.message : "Internal server error",
      source: "admin-api",
      metadata: {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      },
    });
    return c.json({ message: err instanceof Error ? err.message : "Internal server error" }, 500);
  })
  .route("/clients", clientsRoute)
  .route("/services", servicesRoute)
  .route("/quotes", quotesRoute)
  .route("/invoices", invoicesRoute)
  .route("/bookings", bookingsRoute)
  .route("/reminders", remindersRoute)
  .route("/exports", exportsRoute)
  .route("/dashboard", dashboardRoute)
  .route("/reports", reportsRoute)
  .route("/packages", packagesRoute)
  .route("/emails", emailsRoute)
  .route("/payment-control", paymentControlRoute)
  .route("/refunds", refundsRoute)
  .route("/messages", messagesRoute)
  .route("/address-lookup", addressLookupRoute)
  .route("/google-calendar", googleCalendarRoute)
  .route("/sms", smsRoute)
  .route("/settings", settingsRoute)
  .route("/audit-log", auditLogRoute)
  .route("/expenses", expensesRoute);

export type AppType = typeof app;
export default app;
