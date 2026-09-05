import { describe, expect, test } from "bun:test";
import { normalize, idFromQuery, matchesId, cmpStr, cmpNum, cmpDate, cmpNumberLike, applyDir } from "./list";

describe("normalize", () => {
  test("strips accents and lowercases, for accent-insensitive search", () => {
    expect(normalize("Gonçalves")).toBe("goncalves");
    expect(normalize("  Daïane  ")).toBe("daiane");
  });

  test("handles null/undefined without throwing", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
  });
});

describe("idFromQuery / matchesId", () => {
  test("parses a bare number or a #-prefixed number", () => {
    expect(idFromQuery("46")).toBe(46);
    expect(idFromQuery("#46")).toBe(46);
    expect(idFromQuery("  # 46  ")).toBe(46);
  });

  test("returns null for a non-ID search string", () => {
    expect(idFromQuery("Rita Gonçalves")).toBeNull();
    expect(idFromQuery("")).toBeNull();
  });

  test("matchesId compares the parsed id against the given id", () => {
    expect(matchesId(46, "#46")).toBe(true);
    expect(matchesId(47, "#46")).toBe(false);
    expect(matchesId(46, "Rita")).toBe(false);
  });
});

describe("cmpStr", () => {
  test("sorts accent/case-insensitively", () => {
    expect(cmpStr("gonçalves", "Goncalves")).toBe(0);
    expect(cmpStr("Ana", "Bruno")).toBeLessThan(0);
  });

  test("sorts empty values last regardless of direction of the other value", () => {
    expect(cmpStr("", "Ana")).toBeGreaterThan(0);
    expect(cmpStr("Ana", "")).toBeLessThan(0);
    expect(cmpStr("", "")).toBe(0);
  });
});

describe("cmpNum", () => {
  test("compares numerically, not lexically", () => {
    expect(cmpNum(2, 10)).toBeLessThan(0);
  });

  test("sorts non-numeric/empty values last", () => {
    expect(cmpNum(null, 5)).toBeGreaterThan(0);
    expect(cmpNum(5, undefined)).toBeLessThan(0);
  });
});

describe("cmpDate", () => {
  test("compares chronologically", () => {
    expect(cmpDate("2026-01-01", "2026-06-01")).toBeLessThan(0);
  });

  test("sorts missing dates last", () => {
    expect(cmpDate(null, "2026-01-01")).toBeGreaterThan(0);
  });
});

describe("cmpNumberLike", () => {
  test("compares invoice-style identifiers numerically per segment", () => {
    expect(cmpNumberLike("2026-0009", "2026-0010")).toBeLessThan(0);
    expect(cmpNumberLike("2026-0146", "2025-9999")).toBeGreaterThan(0);
  });

  test("treats equal identifiers as equal", () => {
    expect(cmpNumberLike("2026-0146", "2026-0146")).toBe(0);
  });
});

describe("applyDir", () => {
  test("flips the comparator sign only for descending order", () => {
    expect(applyDir(1, "asc")).toBe(1);
    expect(applyDir(1, "desc")).toBe(-1);
    expect(applyDir(-1, "desc")).toBe(1);
  });
});
