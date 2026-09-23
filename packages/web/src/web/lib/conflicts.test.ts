import { describe, expect, test } from "bun:test";
import { findConflicts, type ConflictBooking, type ConflictGoogleBlock } from "./conflicts";

const TODAY = "2026-09-21";
const dur = (id: number | null) => (id === 10 ? 90 : 60);
const booking = (o: Partial<ConflictBooking> & { id: number }): ConflictBooking => ({
  name: `Client ${o.id}`, serviceId: 3, date: "2026-09-28", startTime: "10:00", status: "confirmed", ...o,
});
const google = (o: Partial<ConflictGoogleBlock> & { key: string }): ConflictGoogleBlock => ({
  summary: "Google event", date: "2026-09-28", startTime: "10:00", endTime: "11:00", ...o,
});
const run = (b: ConflictBooking[], g: ConflictGoogleBlock[], from = "2026-09-21", to = "2026-10-31") =>
  findConflicts(b, g, dur, TODAY, from, to);

describe("findConflicts", () => {
  test("the reported case: an online booking on top of an existing Google event", () => {
    const r = run(
      [booking({ id: 93, name: "Tamara Smits", serviceId: 10, startTime: "10:00" })],
      [google({ key: "k1", summary: "Krista van Huis", startTime: "10:00", endTime: "11:30" })],
    );
    expect(r.items).toEqual([{ date: "2026-09-28", time: "10:00", text: "Tamara Smits × Krista van Huis" }]);
    expect([...r.bookingIds]).toEqual([93]);
    expect([...r.googleKeys]).toEqual(["k1"]);
    expect([...r.dates]).toEqual(["2026-09-28"]);
  });

  test("a partial overlap counts; back-to-back sessions do not", () => {
    expect(run([booking({ id: 1, startTime: "10:30" })], [google({ key: "a", startTime: "10:00", endTime: "11:00" })]).items).toHaveLength(1);
    expect(run([booking({ id: 1, startTime: "11:00" })], [google({ key: "a", startTime: "10:00", endTime: "11:00" })]).items).toHaveLength(0);
    expect(run([booking({ id: 1, startTime: "09:00" })], [google({ key: "a", startTime: "10:00", endTime: "11:00" })]).items).toHaveLength(0);
  });

  test("an event that runs to midnight ('24:00') overlaps an evening booking", () => {
    const r = run([booking({ id: 1, startTime: "18:30" })], [google({ key: "a", startTime: "00:00", endTime: "24:00" })]);
    expect(r.items).toHaveLength(1);
  });

  test("two bookings on top of each other, reported once", () => {
    const r = run([booking({ id: 1, startTime: "09:00", name: "Bea" }), booking({ id: 2, startTime: "09:30", name: "Cris" })], []);
    expect(r.items).toEqual([{ date: "2026-09-28", time: "09:00", text: "Bea × Cris" }]);
    expect([...r.bookingIds].sort()).toEqual([1, 2]);
  });

  test("cancelled and no-show bookings are ignored", () => {
    const g = [google({ key: "a" })];
    expect(run([booking({ id: 1, status: "cancelled" })], g).items).toHaveLength(0);
    expect(run([booking({ id: 1, status: "no_show" })], g).items).toHaveLength(0);
    expect(run([booking({ id: 1, status: "cancelled" }), booking({ id: 2 })], []).items).toHaveLength(0);
  });

  test("past days are ignored, and so is anything outside the requested range", () => {
    const g = [google({ key: "a", date: "2026-09-10" })];
    expect(run([booking({ id: 1, date: "2026-09-10" })], g).items).toHaveLength(0); // before today
    expect(run([booking({ id: 1 })], [google({ key: "a" })], "2026-10-05", "2026-10-11").items).toHaveLength(0); // other week
  });

  test("different days never conflict", () => {
    expect(run([booking({ id: 1, date: "2026-09-28" })], [google({ key: "a", date: "2026-09-29" })]).items).toHaveLength(0);
  });

  test("group-class bookings never conflict with each other, even stacked on the exact same slot", () => {
    const r = run(
      [
        booking({ id: 1, startTime: "09:00", name: "Bea", isGroupBooking: true }),
        booking({ id: 2, startTime: "09:00", name: "Cris", isGroupBooking: true }),
        booking({ id: 3, startTime: "09:00", name: "Ana", isGroupBooking: true }),
      ],
      [],
    );
    expect(r.items).toHaveLength(0);
  });

  test("a group-class booking is also exempt from a Google-event overlap (it's likely the class itself)", () => {
    const r = run([booking({ id: 1, startTime: "10:00", isGroupBooking: true })], [google({ key: "a", startTime: "10:00", endTime: "11:00" })]);
    expect(r.items).toHaveLength(0);
  });

  test("a group-class booking overlapping a NON-group booking is still exempted (one flag is enough)", () => {
    const r = run(
      [booking({ id: 1, startTime: "09:00", name: "Bea", isGroupBooking: true }), booking({ id: 2, startTime: "09:00", name: "Cris" })],
      [],
    );
    expect(r.items).toHaveLength(0);
  });

  test("results are ordered by date then time", () => {
    const r = run(
      [booking({ id: 1, date: "2026-10-02", startTime: "14:00" }), booking({ id: 2, date: "2026-09-28", startTime: "16:00" })],
      [google({ key: "x", date: "2026-10-02", startTime: "14:00", endTime: "15:00" }), google({ key: "y", date: "2026-09-28", startTime: "16:00", endTime: "17:00" })],
    );
    expect(r.items.map((i) => i.date)).toEqual(["2026-09-28", "2026-10-02"]);
  });
});
