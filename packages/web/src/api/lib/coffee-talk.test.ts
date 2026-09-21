import { describe, expect, test } from "bun:test";
import { isCoffeeTalkService, schedulingLocation } from "./coffee-talk";

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

describe("schedulingLocation", () => {
  const coffee = { name: "Coffee & Talk" };
  const massage = { name: "Daï Massage — 60 min" };

  test("Coffee & Talk with Rotterdam is not tied to Rotterdam's weekdays", () => {
    expect(schedulingLocation("rotterdam", coffee)).toBeUndefined();
  });

  test("everything else keeps the location split", () => {
    expect(schedulingLocation("rotterdam", massage)).toBe("rotterdam");
    expect(schedulingLocation("amsterdam", coffee)).toBe("amsterdam");
    expect(schedulingLocation("amsterdam", massage)).toBe("amsterdam");
    expect(schedulingLocation(undefined, coffee)).toBeUndefined();
  });
});
