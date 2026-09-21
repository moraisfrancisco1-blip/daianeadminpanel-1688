import { describe, expect, test } from "bun:test";
import { eventToDaySegments, shiftDate } from "./busy-intervals";

describe("shiftDate", () => {
  test("crosses month and year boundaries", () => {
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("eventToDaySegments", () => {
  const range = ["2026-09-21", "2026-09-27"] as const;

  test("a timed event becomes one segment on its day", () => {
    const segs = eventToDaySegments(
      { id: "a", start: { dateTime: "2026-09-22T10:00:00+02:00" }, end: { dateTime: "2026-09-22T11:30:00+02:00" } },
      ...range,
    );
    expect(segs).toEqual([{ date: "2026-09-22", startMin: 600, endMin: 690, allDay: false }]);
  });

  test("a multi-day all-day event covers each day (end date is exclusive)", () => {
    const segs = eventToDaySegments({ id: "b", start: { date: "2026-09-23" }, end: { date: "2026-09-25" } }, ...range);
    expect(segs.map((s) => s.date)).toEqual(["2026-09-23", "2026-09-24"]);
    expect(segs.every((s) => s.allDay && s.startMin === 0 && s.endMin === 1440)).toBe(true);
  });

  test("an overnight event is split across both days", () => {
    const segs = eventToDaySegments(
      { id: "c", start: { dateTime: "2026-09-22T22:00:00+02:00" }, end: { dateTime: "2026-09-23T07:00:00+02:00" } },
      ...range,
    );
    expect(segs).toEqual([
      { date: "2026-09-22", startMin: 1320, endMin: 1440, allDay: false },
      { date: "2026-09-23", startMin: 0, endMin: 420, allDay: false },
    ]);
  });

  test("days outside the requested range are dropped", () => {
    const segs = eventToDaySegments({ id: "d", start: { date: "2026-09-26" }, end: { date: "2026-09-30" } }, ...range);
    expect(segs.map((s) => s.date)).toEqual(["2026-09-26", "2026-09-27"]);
  });

  test("cancelled and free (transparent) events don't block anything", () => {
    const base = { id: "e", start: { dateTime: "2026-09-22T10:00:00+02:00" }, end: { dateTime: "2026-09-22T11:00:00+02:00" } };
    expect(eventToDaySegments({ ...base, status: "cancelled" }, ...range)).toEqual([]);
    expect(eventToDaySegments({ ...base, transparency: "transparent" }, ...range)).toEqual([]);
  });
});
