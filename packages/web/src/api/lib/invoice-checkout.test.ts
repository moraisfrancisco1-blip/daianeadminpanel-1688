import { describe, expect, test } from "bun:test";
import { PAY_TOKEN_RE, payUrl } from "./invoice-checkout";

describe("PAY_TOKEN_RE", () => {
  test("accepts a 32-char lowercase hex token (randomUUID with dashes stripped)", () => {
    // randomUUID() "3fa85f64-5717-4562-b3fc-2c963f66afa6" with dashes stripped -> 32 hex chars.
    expect(PAY_TOKEN_RE.test("3fa85f6457174562b3fc2c963f66afa6")).toBe(true);
    expect(PAY_TOKEN_RE.test("a".repeat(32))).toBe(true);
  });

  test("rejects anything else", () => {
    expect(PAY_TOKEN_RE.test("")).toBe(false);
    expect(PAY_TOKEN_RE.test("a".repeat(31))).toBe(false);
    expect(PAY_TOKEN_RE.test("a".repeat(33))).toBe(false);
    expect(PAY_TOKEN_RE.test("A".repeat(32))).toBe(false); // uppercase
    expect(PAY_TOKEN_RE.test("g".repeat(32))).toBe(false); // not hex
    expect(PAY_TOKEN_RE.test("../../etc/passwd")).toBe(false);
  });
});

describe("payUrl", () => {
  test("builds an /api/payments/pay/:token link on WEBSITE_URL, trailing slash tolerated", () => {
    const prev = process.env.WEBSITE_URL;
    process.env.WEBSITE_URL = "https://admin.studiodaioakes.com/";
    expect(payUrl("abc123")).toBe("https://admin.studiodaioakes.com/api/payments/pay/abc123");
    process.env.WEBSITE_URL = prev;
  });
});
