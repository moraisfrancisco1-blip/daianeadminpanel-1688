import { describe, expect, test } from "bun:test";
import { invoiceDescriptionForService, DCS_LABEL } from "./invoice-description";

describe("invoiceDescriptionForService", () => {
  test("relabels a service named with 'massage' regardless of case", () => {
    expect(invoiceDescriptionForService({ name: "Deep Tissue Massage", durationMinutes: 60 })).toBe(`60' ${DCS_LABEL}`);
    expect(invoiceDescriptionForService({ name: "MASSAGE Relax" })).toBe(DCS_LABEL);
  });

  test("relabels a service whose description mentions 'deep core somatic', even if its name doesn't", () => {
    expect(
      invoiceDescriptionForService({ name: "Recovery Session", description: "A Deep Core Somatic mobility class", durationMinutes: 45 }),
    ).toBe(`45' ${DCS_LABEL}`);
  });

  test("omits the duration prefix when durationMinutes is not provided", () => {
    expect(invoiceDescriptionForService({ name: "Massage" })).toBe(DCS_LABEL);
  });

  test("leaves an unrelated service name untouched", () => {
    expect(invoiceDescriptionForService({ name: "Coffee & Talk", durationMinutes: 30 })).toBe("Coffee & Talk");
  });

  test("never lets the literal word 'massage' reach the output", () => {
    const result = invoiceDescriptionForService({ name: "Swedish Massage", durationMinutes: 90 });
    expect(result.toLowerCase()).not.toContain("massage");
  });
});
