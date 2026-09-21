import { describe, expect, test } from "bun:test";
import { busyBlockToMinutes, eventToDaySegments, shiftDate } from "./busy-intervals";

describe("busyBlockToMinutes", () => {
  test("a normal timed block (offset form) maps to local minutes", () => {
    const r = busyBlockToMinutes({ start: "2026-09-21T14:00:00+02:00", end: "2026-09-21T15:30:00+02:00" }, "2026-09-21");
    expect(r).toEqual({ start: 14 * 60, end: 15 * 60 + 30 });
  });

  test("UTC ('Z') timestamps are converted to Amsterdam wall-clock (summer, +2h)", () => {
    const r = busyBlockToMinutes({ start: "2026-09-21T12:00:00Z", end: "2026-09-21T13:00:00Z" }, "2026-09-21");
    expect(r).toEqual({ start: 14 * 60, end: 15 * 60 });
  });

  test("UTC timestamps in winter use +1h", () => {
    const r = busyBlockToMinutes({ start: "2026-12-10T12:00:00Z", end: "2026-12-10T13:00:00Z" }, "2026-12-10");
    expect(r).toEqual({ start: 13 * 60, end: 14 * 60 });
  });

  test("an all-day event blocks the whole day (used to collapse to a zero-length block)", () => {
    const r = busyBlockToMinutes({ start: "2026-09-21T00:00:00+02:00", end: "2026-09-22T00:00:00+02:00" }, "2026-09-21");
    expect(r).toEqual({ start: 0, end: 24 * 60 });
  });

  test("an event starting the day before and ending this morning blocks the morning", () => {
    const r = busyBlockToMinutes({ start: "2026-09-20T22:00:00+02:00", end: "2026-09-21T08:00:00+02:00" }, "2026-09-21");
    expect(r).toEqual({ start: 0, end: 8 * 60 });
  });

  test("an event starting this evening and ending tomorrow blocks the evening", () => {
    const r = busyBlockToMinutes({ start: "2026-09-21T20:00:00+02:00", end: "2026-09-22T09:00:00+02:00" }, "2026-09-21");
    expect(r).toEqual({ start: 20 * 60, end: 24 * 60 });
  });

  test("blocks on other days are ignored", () => {
    expect(busyBlockToMinutes({ start: "2026-09-20T10:00:00+02:00", end: "2026-09-20T11:00:00+02:00" }, "2026-09-21")).toBeNull();
    expect(busyBlockToMinutes({ start: "2026-09-22T10:00:00+02:00", end: "2026-09-22T11:00:00+02:00" }, "2026-09-21")).toBeNull();
  });

  test("a block that ends exactly at this day's midnight does not bleed into it", () => {
    expect(busyBlockToMinutes({ start: "2026-09-20T22:00:00+02:00", end: "2026-09-21T00:00:00+02:00" }, "2026-09-21")).toBeNull();
  });
});

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
