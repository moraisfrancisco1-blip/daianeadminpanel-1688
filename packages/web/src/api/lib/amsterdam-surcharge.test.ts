import { describe, expect, test } from "bun:test";
import { amsterdamSurcharge, AMSTERDAM_TRAVEL_SURCHARGE } from "./amsterdam-surcharge";

describe("amsterdamSurcharge", () => {
  test("the reported case: 60 min (100) and 90 min (125) both get +25 for Amsterdam", () => {
    expect(100 + amsterdamSurcharge("amsterdam", 100)).toBe(125);
    expect(125 + amsterdamSurcharge("amsterdam", 125)).toBe(150);
  });

  test("applies to every paid service, not just 60/90 min", () => {
    expect(amsterdamSurcharge("amsterdam", 75)).toBe(AMSTERDAM_TRAVEL_SURCHARGE);
  });

  test("Rotterdam never gets the surcharge", () => {
    expect(amsterdamSurcharge("rotterdam", 100)).toBe(0);
  });

  test("a free service (Coffee & Talk) is never surcharged, even for Amsterdam", () => {
    expect(amsterdamSurcharge("amsterdam", 0)).toBe(0);
  });
});
