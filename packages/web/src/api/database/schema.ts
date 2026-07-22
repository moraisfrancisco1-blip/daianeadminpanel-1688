import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
  debtorNumber: text("debtor_number"),
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

export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id").notNull(),
  amount: real("amount").notNull(),
  method: text("method").notNull().default("manual"), // manual, stripe, ideal, cash, bank_transfer
  paidAt: integer("paid_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  notes: text("notes"),
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
  createdAt: integer("created_at", { mode: "timestamp" })
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

export * from "./auth-schema";
