import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { authMiddleware } from "./middleware/auth";
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
import { reportVoltWatchEvent } from "./services/volt-watch";

const app = new Hono()
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }))
  // Public health endpoint used by VOLT CORE uptime monitoring. No customer data is exposed.
  .get("/api/health", (c) => c.json({ status: "ok", service: "daiane-oakes-admin" }, 200))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  // Stripe webhook must be registered BEFORE auth middleware (no auth required)
  .route("/api/stripe-webhook", stripeWebhookRoute)
  .basePath("api")
  .use("*", authMiddleware)
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
  .route("/settings", settingsRoute);

export type AppType = typeof app;
export default app;
