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

const app = new Hono()
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  // Stripe webhook must be registered BEFORE auth middleware (no auth required)
  .route("/api/stripe-webhook", stripeWebhookRoute)
  .basePath("api")
  .use("*", authMiddleware)
  .onError((err, c) => {
    console.error("[api error]", err);
    return c.json({ message: err instanceof Error ? err.message : "Internal server error" }, 500);
  })
  .get("/health", (c) => c.json({ status: "ok" }, 200))
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
  .route("/google-calendar", googleCalendarRoute);

export type AppType = typeof app;
export default app;
