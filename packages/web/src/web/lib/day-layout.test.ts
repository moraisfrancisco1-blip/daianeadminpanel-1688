import { describe, expect, test } from "bun:test";
import { layoutOverlaps } from "./day-layout";

describe("layoutOverlaps", () => {
  test("a single booking gets column 0 of 1", () => {
    const r = layoutOverlaps([{ id: 1, start: 540, end: 600 }]);
    expect(r.get(1)).toEqual({ col: 0, cols: 1 });
  });

  test("two bookings that don't overlap each keep column 0 of 1 (no split needed)", () => {
    const r = layoutOverlaps([
      { id: 1, start: 540, end: 600 },
      { id: 2, start: 600, end: 660 }, // back-to-back, not overlapping
    ]);
    expect(r.get(1)).toEqual({ col: 0, cols: 1 });
    expect(r.get(2)).toEqual({ col: 0, cols: 1 });
  });

  test("the reported case: two bookings at the exact same time split into 2 side-by-side columns", () => {
    const r = layoutOverlaps([
      { id: 1, start: 540, end: 600 },
      { id: 2, start: 540, end: 600 },
    ]);
    const a = r.get(1)!;
    const b = r.get(2)!;
    expect(a.cols).toBe(2);
    expect(b.cols).toBe(2);
    expect(new Set([a.col, b.col])).toEqual(new Set([0, 1]));
  });

  test("a group class of 6 people at the same slot gets 6 columns", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, start: 540, end: 600 }));
    const r = layoutOverlaps(items);
    for (const it of items) expect(r.get(it.id)!.cols).toBe(6);
    expect(new Set([...r.values()].map((v) => v.col))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  test("a partial overlap (one starts mid-way through another) still splits into 2 columns", () => {
    const r = layoutOverlaps([
      { id: 1, start: 540, end: 600 },
      { id: 2, start: 570, end: 630 },
    ]);
    expect(r.get(1)!.cols).toBe(2);
    expect(r.get(2)!.cols).toBe(2);
  });

  test("a booking freed up by an earlier one ending reuses that column, but the cluster still gets 2 columns", () => {
    // A: 09:00-10:00, B: 09:30-10:30 (overlaps A), C: 10:00-10:30 (overlaps B only, A already ended)
    const r = layoutOverlaps([
      { id: 1, start: 540, end: 600 },
      { id: 2, start: 570, end: 630 },
      { id: 3, start: 600, end: 630 },
    ]);
    expect(r.get(1)!.cols).toBe(2);
    expect(r.get(2)!.cols).toBe(2);
    expect(r.get(3)!.cols).toBe(2);
    expect(r.get(1)!.col).not.toBe(r.get(2)!.col);
    // C can reuse A's now-free column, but must differ from B's (still active at 10:00).
    expect(r.get(3)!.col).not.toBe(r.get(2)!.col);
  });

  test("two separate clusters on the same day are laid out independently", () => {
    const r = layoutOverlaps([
      { id: 1, start: 540, end: 600 },
      { id: 2, start: 540, end: 600 },
      { id: 3, start: 720, end: 780 }, // a later, unrelated single booking
    ]);
    expect(r.get(1)!.cols).toBe(2);
    expect(r.get(2)!.cols).toBe(2);
    expect(r.get(3)).toEqual({ col: 0, cols: 1 });
  });
});
