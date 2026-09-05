import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * You can write your custom database schema here.
 * Use this file for also re-exporting any generated schema for drizzle to generate proper migrations.
 */

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  zipCode: text("zip_code"),
  city: text("city"),
  country: text("country"),
  dateOfBirth: integer("date_of_birth", { mode: "timestamp" }),
  notes: text("notes"),
  // Health/session-related notes (e.g. areas of tension, contraindications) —
  // kept separate from the general `notes` field above.
  clinicalNotes: text("clinical_notes"),
  debtorNumber: text("debtor_number"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Timestamped follow-up notes on a client (separate from the single free-text
// `clients.notes` field) — each one can be individually marked resolved and
// surfaces as a dashboard reminder while unresolved.
export const clientNotes = sqliteTable("client_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull(),
  content: text("content").notNull(),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const services = sqliteTable("services", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  groupLabel: text("group_label"), // groups duration/price variants of the same service (e.g. "Daï Massage")
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  price: real("price").notNull(),
  vatRate: real("vat_rate").notNull().default(0.09), // 0, 0.09, 0.21
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const quotes = sqliteTable("quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteNumber: text("quote_number").notNull().unique(),
  clientId: integer("client_id").notNull(),
  status: text("status").notNull().default("draft"), // draft, sent, accepted, declined
  issueDate: integer("issue_date", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  validUntil: integer("valid_until", { mode: "timestamp" }),
  notes: text("notes"),
  subtotal: real("subtotal").notNull().default(0),
  vatTotal: real("vat_total").notNull().default(0),
  total: real("total").notNull().default(0),
  convertedInvoiceId: integer("converted_invoice_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const quoteItems = sqliteTable("quote_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteId: integer("quote_id").notNull(),
  serviceId: integer("service_id"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull(),
  vatRate: real("vat_rate").notNull().default(0.09),
  amount: real("amount").notNull(),
});

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNumber: text("invoice_number").notNull().unique(),
  clientId: integer("client_id").notNull(),
  quoteId: integer("quote_id"),
  bookingId: integer("booking_id"),
  status: text("status").notNull().default("draft"), // draft, sent, paid, overdue, cancelled
  isTest: integer("is_test", { mode: "boolean" }).notNull().default(false),
  issueDate: integer("issue_date", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  dueDate: integer("due_date", { mode: "timestamp" }).notNull(),
  notes: text("notes"),
  subtotal: real("subtotal").notNull().default(0),
  vatTotal: real("vat_total").notNull().default(0),
  total: real("total").notNull().default(0),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  lastReminderAt: integer("last_reminder_at", { mode: "timestamp" }),
  reminderCount: integer("reminder_count").notNull().default(0),
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  // Snapshot of the real Stripe state, kept fresh by webhooks and the Payment Control "Verify" action.
  stripeCheckoutStatus: text("stripe_checkout_status"), // open | complete | expired | processing
  stripePaymentIntentStatus: text("stripe_payment_intent_status"), // succeeded | processing | requires_payment_method | canceled | requires_action
  lastStripeVerifiedAt: integer("last_stripe_verified_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const invoiceItems = sqliteTable("invoice_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull(),
  serviceId: integer("service_id"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull(),
  vatRate: real("vat_rate").notNull().default(0.09),
  amount: real("amount").notNull(),
});

export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id").notNull(),
    amount: real("amount").notNull(),
    method: text("method").notNull().default("manual"), // manual, stripe, ideal, cash, bank_transfer
    paidAt: integer("paid_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    notes: text("notes"),
    // Stripe PaymentIntent ID — null for manual payments, unique for Stripe payments.
    stripePaymentIntentId: text("stripe_payment_intent_id"),
  },
  (table) => [
    // Unique only for non-null values (manual payments keep NULL and can repeat).
    uniqueIndex("payments_stripe_payment_intent_id_unique")
      .on(table.stripePaymentIntentId)
      .where(sql`${table.stripePaymentIntentId} IS NOT NULL`),
  ],
);

// Refunds against a payment — recorded automatically from Stripe's charge.refunded
// webhook (one row per Stripe Refund object, so partial refunds are tracked
// individually). invoiceId is denormalized from the payment for easy querying.
export const refunds = sqliteTable("refunds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: integer("payment_id").notNull(),
  invoiceId: integer("invoice_id").notNull(),
  amount: real("amount").notNull(),
  reason: text("reason"), // duplicate | fraudulent | requested_by_customer | other
  status: text("status").notNull().default("succeeded"), // pending | succeeded | failed | canceled
  stripeRefundId: text("stripe_refund_id").unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  serviceId: integer("service_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:MM
  location: text("location").notNull().default("rotterdam"), // rotterdam (Mon/Wed/Fri studio) | amsterdam (Tue/Thu only)
  status: text("status").notNull().default("pending_deposit"), // pending_deposit, confirmed, cancelled, completed, no_show
  depositAmount: real("deposit_amount").notNull().default(25),
  depositStatus: text("deposit_status").notNull().default("unpaid"), // unpaid, paid, refunded
  payFullNow: integer("pay_full_now", { mode: "boolean" }).notNull().default(false),
  paymentMethod: text("payment_method"), // stripe_card, ideal
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  invoiceId: integer("invoice_id"),
  notes: text("notes"),
  googleEventId: text("google_event_id"), // Google Calendar event id, once synced
  postSessionEmailSentAt: integer("post_session_email_sent_at", { mode: "timestamp" }), // review/promo email sent
  reminder2dSentAt: integer("reminder_2d_sent_at", { mode: "timestamp" }), // "session in 2 days" reminder sent
  reminder1dSentAt: integer("reminder_1d_sent_at", { mode: "timestamp" }), // "session tomorrow" reminder sent
  remainderEmailSentAt: integer("remainder_email_sent_at", { mode: "timestamp" }), // "pay remainder" email sent (10 min before end)
  rebookReminderSentAt: integer("rebook_reminder_sent_at", { mode: "timestamp" }), // "come back and rebook" email sent
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One-off blocked time slots (specific dates/times marked unavailable by the admin).
export const blockedSlots = sqliteTable("blocked_slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(), // HH:MM
  endTime: text("end_time").notNull(), // HH:MM
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Prepaid session packages (credits) assigned to a client.
export const packages = sqliteTable("packages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull(),
  name: text("name").notNull(), // e.g. "Pacote 5 sessões"
  totalSessions: integer("total_sessions").notNull(),
  sessionsUsed: integer("sessions_used").notNull().default(0),
  price: real("price").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  purchasedAt: integer("purchased_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const packageUsages = sqliteTable("package_usages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  packageId: integer("package_id").notNull(),
  bookingId: integer("booking_id"),
  sessions: integer("sessions").notNull().default(1),
  usedAt: integer("used_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Single-row table (id always "primary") holding the connected Google account's OAuth tokens
// for the bidirectional Google Calendar integration (creating events + reading busy slots).
export const googleCalendarAuth = sqliteTable("google_calendar_auth", {
  id: text("id").primaryKey(), // always "primary"
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiryDate: integer("expiry_date", { mode: "timestamp" }).notNull(),
  connectedEmail: text("connected_email"),
  selectedCalendarId: text("selected_calendar_id").notNull().default("primary"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const counters = sqliteTable("counters", {
  id: text("id").primaryKey(), // e.g. "invoice_2026", "quote_2026"
  value: integer("value").notNull().default(0),
});

export const stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
  // Stripe event id (evt_...) — the primary key enforces a single row per event.
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  // processing | processed | failed
  status: text("status").notNull().default("processing"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Persistent audit trail for a single invoice (all events related to that invoice).
export const invoiceActivity = sqliteTable("invoice_activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull(),
  // created | edited | sent | payment_link_created | payment_link_sent | status_changed |
  // payment_recorded | payment_confirmed | refunded | email_failed | cancelled | other
  type: text("type").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  // admin | stripe | manual | email | system
  channel: text("channel").notNull().default("system"),
  recipientEmail: text("recipient_email"),
  amount: real("amount"),
  method: text("method"),
  // free-form JSON for extra context (e.g. Stripe PI id, message id, error)
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Global log of every email sent by the platform (proof of delivery/failure).
export const emailLog = sqliteTable(
  "email_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    clientId: integer("client_id"),
    invoiceId: integer("invoice_id"),
    bookingId: integer("booking_id"),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    // invoice | payment_link | booking_confirmation | reminder | cancellation | quote | package | other
    type: text("type").notNull().default("other"),
    subject: text("subject").notNull(),
    // sent | failed  (Delivered only if the provider confirms it — Resend does not for emails.send)
    status: text("status").notNull().default("sent"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    provider: text("provider").notNull().default("resend"),
    // "historical_import" = imported from the provider; "current_system" = sent by the running platform.
    // Default matches the column's actual default in production (set before this
    // was renamed to "current_system" in application code, which always passes
    // it explicitly) — kept in sync so drizzle-kit push doesn't see a false diff
    // and try to rebuild this table over a mismatched DEFAULT.
    source: text("source").notNull().default("system"),
  },
  (table) => [
    // Dedup / idempotency for historical imports — one row per provider message id.
    uniqueIndex("email_log_provider_message_id_unique")
      .on(table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
  ],
);

// Manual outbound messages sent from the "Messages" quick-template page —
// separate from emailLog (automated transactional emails). For whatsapp/email,
// "sent" only means the admin opened the app with the message pre-filled
// (there's no delivery confirmation for those channels); SMS status reflects
// the real Twilio result.
export const messageLog = sqliteTable("message_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id"),
  channel: text("channel").notNull(), // whatsapp | sms | email
  recipient: text("recipient").notNull(),
  templateId: text("template_id"),
  body: text("body").notNull(),
  status: text("status").notNull().default("sent"), // sent | failed | opened
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Single-row table (id always "primary") holding the editable company/invoice
// details shown on invoice PDFs — overrides the hardcoded defaults in
// api/lib/company.ts once the admin edits them from Settings.
export const companySettings = sqliteTable("company_settings", {
  id: text("id").primaryKey(),
  name: text("name"),
  address: text("address"),
  zipCity: text("zip_city"),
  kvk: text("kvk"),
  vat: text("vat"),
  iban: text("iban"),
  phone: text("phone"),
  paymentTermDays: integer("payment_term_days"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// One row per request counted against a rate limit (e.g. "login:1.2.3.4",
// "public-booking:1.2.3.4"). A window's hit count is just the number of rows
// for that key newer than the window — old rows are pruned opportunistically
// by the rate-limit check itself rather than a separate job.
export const rateLimitHits = sqliteTable("rate_limit_hits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A trail of admin actions not already covered by the invoice-specific
// invoiceActivity table above — deletions and edits to bookings, clients,
// packages, quotes, services and settings, which previously left no record
// of who did what.
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: text("actor_user_id"),
  actorEmail: text("actor_email"),
  action: text("action").notNull(), // e.g. "deleted", "updated", "price_changed"
  entityType: text("entity_type").notNull(), // e.g. "booking", "package", "quote", "service", "settings"
  entityId: text("entity_id"),
  metadata: text("metadata"), // JSON-stringified details (before/after, etc.)
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Business expenses (Vodafone, domain/hosting, ads, etc.) — purchase invoices
// the business receives, as opposed to `invoices` above which it issues.
// Their VAT is deductible against what's collected on sales invoices, so the
// quarterly VAT report/export needs both sides to compute what's actually owed.
export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplier: text("supplier").notNull(),
  category: text("category"), // e.g. Telecom, Software, Advertising, Domain/Hosting, Office, Travel, Other
  invoiceNumber: text("invoice_number"),
  issueDate: integer("issue_date", { mode: "timestamp" }).notNull(),
  netAmount: real("net_amount").notNull(),
  vatAmount: real("vat_amount").notNull().default(0),
  vatRate: real("vat_rate").notNull().default(0.21),
  totalAmount: real("total_amount").notNull(),
  notes: text("notes"),
  attachmentUrl: text("attachment_url"),
  attachmentFilename: text("attachment_filename"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export * from "./auth-schema";
