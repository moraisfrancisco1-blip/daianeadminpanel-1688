import { describe, expect, test } from "bun:test";
import { computeVat, computeTotals, vatBreakdownFromNet, netToGross, round2, computeDiscountAmount, discountLineInput } from "./totals";

describe("computeVat", () => {
  test("splits a gross amount into net + VAT at 9%", () => {
    const { net, vat } = computeVat(109, 0.09);
    expect(net).toBeCloseTo(100, 2);
    expect(vat).toBeCloseTo(9, 2);
  });

  test("handles 0% VAT (exempt services)", () => {
    const { net, vat } = computeVat(50, 0);
    expect(net).toBe(50);
    expect(vat).toBe(0);
  });
});

describe("netToGross", () => {
  test("is the inverse of computeVat's net split", () => {
    const gross = 109;
    const { net } = computeVat(gross, 0.09);
    expect(netToGross(net, 0.09)).toBeCloseTo(gross, 2);
  });
});

describe("computeTotals", () => {
  test("sums multiple lines at different VAT rates into a correct grand total", () => {
    const { subtotal, vatTotal, total, lineItems } = computeTotals([
      { description: "Massage 60min", quantity: 1, unitPrice: 80, vatRate: 0.09 },
      { description: "Travel", quantity: 1, unitPrice: 20, vatRate: 0.21 },
    ]);
    expect(total).toBeCloseTo(100, 2);
    expect(subtotal + vatTotal).toBeCloseTo(total, 2);
    expect(lineItems).toHaveLength(2);
    // Line amounts are NET, not the gross unitPrice passed in.
    expect(lineItems[0]!.amount).toBeLessThan(80);
  });

  test("quantity multiplies the gross unit price before splitting VAT", () => {
    const { total } = computeTotals([{ description: "Session", quantity: 3, unitPrice: 50, vatRate: 0.09 }]);
    expect(total).toBeCloseTo(150, 2);
  });

  test("groups the VAT breakdown by rate, not by line", () => {
    const { vatBreakdown } = computeTotals([
      { description: "A", quantity: 1, unitPrice: 109, vatRate: 0.09 },
      { description: "B", quantity: 1, unitPrice: 109, vatRate: 0.09 },
      { description: "C", quantity: 1, unitPrice: 121, vatRate: 0.21 },
    ]);
    expect(vatBreakdown).toHaveLength(2);
    const nine = vatBreakdown.find((b) => b.rate === 0.09)!;
    expect(nine.base).toBeCloseTo(200, 2);
  });
});

describe("vatBreakdownFromNet", () => {
  test("reconstructs a per-rate VAT breakdown from already-net line amounts", () => {
    const breakdown = vatBreakdownFromNet([
      { amount: 100, vatRate: 0.09 },
      { amount: 50, vatRate: 0.21 },
    ]);
    expect(breakdown).toEqual(
      expect.arrayContaining([
        { rate: 0.09, base: 100, vat: 9 },
        { rate: 0.21, base: 50, vat: 10.5 },
      ]),
    );
  });

  test("merges multiple lines at the same rate into one bucket", () => {
    const breakdown = vatBreakdownFromNet([
      { amount: 50, vatRate: 0.09 },
      { amount: 50, vatRate: 0.09 },
    ]);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual({ rate: 0.09, base: 100, vat: 9 });
  });

  test("returns an empty array for no items (empty quarter)", () => {
    expect(vatBreakdownFromNet([])).toEqual([]);
  });
});

describe("round2", () => {
  test("rounds to 2 decimal places", () => {
    expect(round2(10 / 3)).toBe(3.33);
    expect(round2(9.999)).toBe(10);
  });
});

describe("computeDiscountAmount", () => {
  test("returns 0 when there's no discount configured", () => {
    expect(computeDiscountAmount(100, null, null)).toBe(0);
    expect(computeDiscountAmount(100, "percent", null)).toBe(0);
    expect(computeDiscountAmount(100, "percent", 0)).toBe(0);
  });

  test("computes a percent discount off the service price", () => {
    expect(computeDiscountAmount(100, "percent", 10)).toBe(10);
    expect(computeDiscountAmount(80, "percent", 25)).toBe(20);
  });

  test("uses a fixed discount as-is", () => {
    expect(computeDiscountAmount(100, "fixed", 15)).toBe(15);
  });

  test("clamps so the discount never exceeds the service price", () => {
    expect(computeDiscountAmount(50, "fixed", 999)).toBe(50);
    expect(computeDiscountAmount(50, "percent", 200)).toBe(50);
  });

  test("clamps a negative discount value to 0", () => {
    expect(computeDiscountAmount(100, "fixed", -20)).toBe(0);
  });
});

describe("discountLineInput", () => {
  test("returns null when there's nothing to discount", () => {
    expect(discountLineInput(100, 0.09, null, null)).toBeNull();
  });

  test("builds a negative line at the service's VAT rate for a percent discount", () => {
    const line = discountLineInput(100, 0.09, "percent", 10);
    expect(line).toEqual({ description: "Discount -10%", quantity: 1, unitPrice: -10, vatRate: 0.09 });
  });

  test("builds a negative line for a fixed discount", () => {
    const line = discountLineInput(100, 0.21, "fixed", 15);
    expect(line).toEqual({ description: "Discount -€15.00", quantity: 1, unitPrice: -15, vatRate: 0.21 });
  });

  test("a discount line correctly reduces the invoice total via computeTotals", () => {
    const service: import("./totals").LineInput = { description: "Massage 60min", quantity: 1, unitPrice: 100, vatRate: 0.09 };
    const discount = discountLineInput(100, 0.09, "percent", 10)!;
    const { total } = computeTotals([service, discount]);
    expect(total).toBeCloseTo(90, 2);
  });
});
