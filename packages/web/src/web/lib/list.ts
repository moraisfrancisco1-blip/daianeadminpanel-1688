import { useState } from "react";

export type SortDir = "asc" | "desc";

/** Lowercase, trim and strip accents for case/accent-insensitive search. */
export function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Parse a pure-ID query like "46", "#46", "  #46  " → 46, else null. */
export function idFromQuery(query: string): number | null {
  const m = query.trim().match(/^#?\s*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/** True when the query is a pure-ID query that matches the given id. */
export function matchesId(id: unknown, query: string): boolean {
  const n = idFromQuery(query);
  return n !== null && Number(id) === n;
}

/** Case/accent-insensitive string compare; empty values sort last. */
export function cmpStr(a: unknown, b: unknown): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 0;
  if (!na) return 1;
  if (!nb) return -1;
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** Numeric compare; non-numbers sort last. */
export function cmpNum(a: unknown, b: unknown): number {
  const na = a === null || a === undefined || a === "" ? NaN : Number(a);
  const nb = b === null || b === undefined || b === "" ? NaN : Number(b);
  if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
  if (Number.isNaN(na)) return 1;
  if (Number.isNaN(nb)) return -1;
  return na - nb;
}

/** Date compare; invalid/empty dates sort last. */
export function cmpDate(a: unknown, b: unknown): number {
  const ta = a ? new Date(a as string | number | Date).getTime() : NaN;
  const tb = b ? new Date(b as string | number | Date).getTime() : NaN;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

/** Number-like compare for identifiers such as "2026-0146" (year + sequence). */
export function cmpNumberLike(a: unknown, b: unknown): number {
  const pa = String(a ?? "").split(/[^0-9]+/).map(Number);
  const pb = String(b ?? "").split(/[^0-9]+/).map(Number);
  if (pa.every(Number.isFinite) && pb.every(Number.isFinite) && pa.length > 0 && pa.length === pb.length) {
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
  }
  return cmpStr(a, b);
}

/** Flip a comparator result for descending direction. */
export function applyDir(n: number, dir: SortDir): number {
  return dir === "desc" ? -n : n;
}

/** Small hook for a sortable column header. */
export function useSort<K extends string>(initialKey: K, initialDir: SortDir = "asc") {
  const [sort, setSort] = useState<{ key: K; dir: SortDir }>({ key: initialKey, dir: initialDir });
  function toggle(key: K) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }
  return { sortKey: sort.key, sortDir: sort.dir, toggle };
}
