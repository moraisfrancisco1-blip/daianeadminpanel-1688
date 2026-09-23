export type ConflictBooking = {
  id: number;
  name: string;
  serviceId: number | null;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  status: string;
  // Admin-only group class (2/4/6 people sharing a slot on purpose) — never a real conflict.
  isGroupBooking?: boolean;
};

export type ConflictGoogleBlock = {
  key: string;
  summary: string;
  date: string;
  startTime: string;
  endTime: string; // "24:00" = until midnight
};

export type ConflictItem = { date: string; time: string; text: string };

export type ConflictReport = {
  items: ConflictItem[];
  bookingIds: Set<number>;
  googleKeys: Set<string>;
  dates: Set<string>;
};

const ACTIVE = new Set(["confirmed", "pending_deposit"]);

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + (m ?? 0);
}

/**
 * Finds things that are on top of each other in the agenda: an active booking
 * overlapping a busy Google Calendar event, or two active bookings overlapping.
 * Only upcoming days inside [from, to] are considered — a past session that
 * overlapped something is history, not something to act on. Bookings that are
 * cancelled / no-show don't count.
 */
export function findConflicts(
  bookings: ConflictBooking[],
  googleBlocks: ConflictGoogleBlock[],
  durationOf: (serviceId: number | null) => number,
  today: string,
  from: string,
  to: string,
): ConflictReport {
  const report: ConflictReport = { items: [], bookingIds: new Set(), googleKeys: new Set(), dates: new Set() };
  const lo = from > today ? from : today;

  const active = bookings
    .filter((b) => ACTIVE.has(b.status) && b.date >= lo && b.date <= to)
    .map((b) => {
      const start = toMin(b.startTime);
      return { b, start, end: start + durationOf(b.serviceId) };
    })
    .sort((x, y) => x.b.date.localeCompare(y.b.date) || x.start - y.start);

  const add = (date: string, start: number, text: string) => {
    const h = String(Math.floor(start / 60)).padStart(2, "0");
    const m = String(start % 60).padStart(2, "0");
    report.items.push({ date, time: `${h}:${m}`, text });
    report.dates.add(date);
  };

  for (const a of active) {
    if (a.b.isGroupBooking) continue; // deliberately shares its slot (e.g. with the class's own Google event)
    for (const g of googleBlocks) {
      if (g.date !== a.b.date) continue;
      if (a.start < toMin(g.endTime) && a.end > toMin(g.startTime)) {
        report.bookingIds.add(a.b.id);
        report.googleKeys.add(g.key);
        add(a.b.date, a.start, `${a.b.name} × ${g.summary}`);
      }
    }
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const x = active[i]!;
      const y = active[j]!;
      if (y.b.date !== x.b.date) break;
      if (x.b.isGroupBooking || y.b.isGroupBooking) continue; // an intentional group-class overlap, not a conflict
      if (x.start < y.end && x.end > y.start) {
        report.bookingIds.add(x.b.id);
        report.bookingIds.add(y.b.id);
        add(x.b.date, Math.min(x.start, y.start), `${x.b.name} × ${y.b.name}`);
      }
    }
  }

  report.items.sort((p, q) => p.date.localeCompare(q.date) || p.time.localeCompare(q.time));
  return report;
}
