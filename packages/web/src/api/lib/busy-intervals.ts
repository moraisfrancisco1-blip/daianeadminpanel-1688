const TZ = "Europe/Amsterdam";

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localParts(iso: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(localFormatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Shifts a YYYY-MM-DD date by a whole number of days (calendar arithmetic, no timezone involved). */
export function shiftDate(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Converts one Google freeBusy block into minutes-of-day for `dateISO`
 * (Europe/Amsterdam wall-clock), clipped to that day. A block that started on
 * an earlier day begins at 00:00; one that ends on a later day (all-day and
 * overnight events) runs to 24:00. Returns null if it doesn't touch the day.
 */
export function busyBlockToMinutes(
  block: { start: string; end: string },
  dateISO: string,
): { start: number; end: number } | null {
  const s = localParts(block.start);
  const e = localParts(block.end);
  if (e.date < dateISO || s.date > dateISO) return null;
  const start = s.date < dateISO ? 0 : s.minutes;
  const end = e.date > dateISO ? 24 * 60 : e.minutes;
  return end > start ? { start, end } : null;
}
