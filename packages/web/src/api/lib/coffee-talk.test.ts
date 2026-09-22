import { describe, expect, test } from "bun:test";
import { isCoffeeTalkService } from "./coffee-talk";

describe("isCoffeeTalkService", () => {
  test("matches the catalog name and casual variants", () => {
    expect(isCoffeeTalkService({ name: "Coffee & Talk" })).toBe(true);
    expect(isCoffeeTalkService({ name: "  coffee&talk " })).toBe(true);
    expect(isCoffeeTalkService({ name: "COFFEE AND TALK" })).toBe(true);
  });

  test("does not match other services", () => {
    expect(isCoffeeTalkService({ name: "Daï Massage — 30 min" })).toBe(false);
    expect(isCoffeeTalkService({ name: "Women's Recovery & PostPartum" })).toBe(false);
    expect(isCoffeeTalkService({ name: "Coffee Break" })).toBe(false);
    expect(isCoffeeTalkService(null)).toBe(false);
    expect(isCoffeeTalkService(undefined)).toBe(false);
  });
});
