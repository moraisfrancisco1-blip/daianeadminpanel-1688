// Requires DATABASE_URL to be set (run with `bun --env-file=../../.env test`,
// same as every other script in this repo) — hits the real local test DB,
// not a mock, because the guarantee being proven here (clinical/PII fields
// never reach this connector's response) has to hold against the real
// schema and the real Drizzle query, not a hand-rolled stand-in for it.
process.env.VOLT_CORE_SERVICE_KEY_DAIOAKES = "test-only-local-key-do-not-use-in-prod";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import app from "../../index";
import { db } from "../../database";
import { clients, invoices, invoiceItems, payments } from "../../database/schema";
import { eq } from "drizzle-orm";

const REAL_KEY = "test-only-local-key-do-not-use-in-prod";
const HEADER = "X-Volt-Core-Key";
const CLINICAL_SECRET = "SECRET_CLINICAL_NOTE_should_never_leak_xyz123";
const CLIENT_NAME = "SECRET_CLIENT_NAME_Jane_Doe";
const CLIENT_EMAIL = "jane.secret@example.com";

let testClientId: number;
let testInvoiceId: number;

beforeAll(async () => {
  const [testClient] = await db
    .insert(clients)
    .values({ name: CLIENT_NAME, email: CLIENT_EMAIL, clinicalNotes: CLINICAL_SECRET, notes: "some internal note" })
    .returning();
  testClientId = testClient.id;

  const [inv] = await db
    .insert(invoices)
    .values({
      invoiceNumber: "TEST-SVC-1",
      clientId: testClientId,
      status: "paid",
      issueDate: new Date("2026-02-01"),
      dueDate: new Date("2026-02-15"),
      subtotal: 100,
      vatTotal: 9,
      total: 109,
      paidAt: new Date("2026-02-05"),
      notes: "SECRET_INVOICE_FREE_TEXT_should_not_leak",
    })
    .returning();
  testInvoiceId = inv.id;

  await db.insert(invoiceItems).values({ invoiceId: testInvoiceId, description: "Test", quantity: 1, unitPrice: 100, vatRate: 0.09, amount: 100 });
  await db.insert(payments).values({ invoiceId: testInvoiceId, amount: 109, method: "stripe", paidAt: new Date("2026-02-05"), notes: "SECRET_PAYMENT_FREE_TEXT_should_not_leak" });
});

afterAll(async () => {
  await db.delete(payments).where(eq(payments.invoiceId, testInvoiceId));
  await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, testInvoiceId));
  await db.delete(invoices).where(eq(invoices.id, testInvoiceId));
  await db.delete(clients).where(eq(clients.id, testClientId));
});

describe("Volt Core service connector — /api/service/payment-control", () => {
  test("valid key returns 200 with the allowlisted fields", async () => {
    const res = await app.request("/api/service/payment-control", { headers: { [HEADER]: REAL_KEY } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { payments: any[] };
    const row = data.payments.find((p) => p.invoiceId === testInvoiceId);
    expect(row).toBeDefined();
    expect(row.invoiceNumber).toBe("TEST-SVC-1");
    expect(row.total).toBe(109);
    expect(row.state).toBe("confirmed");
  });

  test("no clinical or PII field ever appears in the response, even though the underlying records have them", async () => {
    const res = await app.request("/api/service/payment-control", { headers: { [HEADER]: REAL_KEY } });
    const data = (await res.json()) as { payments: any[] };
    const raw = JSON.stringify(data);

    expect(raw).not.toInclude(CLINICAL_SECRET);
    expect(raw).not.toInclude(CLIENT_NAME);
    expect(raw).not.toInclude(CLIENT_EMAIL);
    expect(raw).not.toInclude("SECRET_INVOICE_FREE_TEXT");
    expect(raw).not.toInclude("SECRET_PAYMENT_FREE_TEXT");

    const row = data.payments.find((p) => p.invoiceId === testInvoiceId);
    for (const forbiddenKey of ["clinicalNotes", "clientName", "clientEmail", "sessionDate", "sessionStartTime", "notes"]) {
      expect(row).not.toHaveProperty(forbiddenKey);
    }
  });

  test("missing key is rejected with 403", async () => {
    const res = await app.request("/api/service/payment-control");
    expect(res.status).toBe(403);
  });

  test("wrong key is rejected with 403", async () => {
    const res = await app.request("/api/service/payment-control", { headers: { [HEADER]: "totally-wrong-key" } });
    expect(res.status).toBe(403);
  });

  test("write methods are rejected with 403 even with a valid key", async () => {
    const post = await app.request("/api/service/payment-control", { method: "POST", headers: { [HEADER]: REAL_KEY } });
    expect(post.status).toBe(403);
    const del = await app.request("/api/service/payment-control", { method: "DELETE", headers: { [HEADER]: REAL_KEY } });
    expect(del.status).toBe(403);
  });

  test("the key has no reach on real clinical/scheduling endpoints outside the allowlist", async () => {
    const clientRes = await app.request(`/api/clients/${testClientId}`, { headers: { [HEADER]: REAL_KEY } });
    expect(clientRes.status).not.toBe(200);
    const bookingsRes = await app.request("/api/bookings", { headers: { [HEADER]: REAL_KEY } });
    expect(bookingsRes.status).not.toBe(200);
  });
});
