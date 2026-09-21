import { db } from "../database";
import { bookings, services } from "../database/schema";
import { eq, or } from "drizzle-orm";
import { updateCalendarEvent } from "../services/google-calendar";
import { calendarEventDescription } from "./booking-details";

const FIELDS = ["name", "email", "phone", "address", "zipCode", "city", "country"] as const;
type Field = (typeof FIELDS)[number];
export type Contact = Record<Field, string | null>;
export type BookingContactRow = Contact & { id: number; clientId: number | null };
// A booking's name and email can never be blank; the other details can.
export type BookingPatchFields = { name?: string; email?: string } & Partial<Record<"phone" | "address" | "zipCode" | "city" | "country", string | null>>;
export type BookingPatch = { id: number; patch: BookingPatchFields };

const norm = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Which bookings should follow a change made to a client's contact details, and how.
 *
 * Every booking keeps its own copy of the name/email/phone/address it was made with, so
 * fixing the client (a typo, a full surname, a new phone number) used to leave the
 * bookings — and the emails/reminders/Google events built from them — on the old values.
 * A booking only follows if it was made under the client's old name, and then only for the
 * fields where it currently MIRRORS the client's old value (or both were blank) — anything
 * the booking deliberately holds differently is left alone.
 */
export function planBookingPatches(before: Contact, after: Contact, rows: BookingContactRow[]): BookingPatch[] {
  const changed = FIELDS.filter((f) => norm(before[f]) !== norm(after[f]));
  if (changed.length === 0) return [];

  const out: BookingPatch[] = [];
  for (const row of rows) {
    // Made under another name (e.g. someone booking for a relative on the same email): not this
    // person's booking, so none of the client's corrections apply to it.
    if (norm(row.name) !== norm(before.name)) continue;
    const patch: BookingPatchFields = {};
    for (const f of changed) {
      if (norm(row[f]) !== norm(before[f])) continue; // this booking was made with something else: keep it
      const next = after[f]?.trim() || null;
      if (f === "name" || f === "email") {
        if (next) patch[f] = next; // booking name/email can never be blank
      } else {
        patch[f] = next;
      }
    }
    if (Object.keys(patch).length > 0) out.push({ id: row.id, patch });
  }
  return out;
}

/**
 * Applies a client's contact-detail change to their bookings and, for upcoming
 * confirmed ones, to the matching Google Calendar event (title, description, guest email).
 * Bookings are matched by client id, or by the client's previous email when not linked yet.
 */
export async function syncBookingsToClient(before: Contact & { id: number }, after: Contact & { id: number }) {
  const oldEmail = before.email?.trim();
  const candidates = await db
    .select()
    .from(bookings)
    .where(oldEmail ? or(eq(bookings.clientId, after.id), eq(bookings.email, oldEmail)) : eq(bookings.clientId, after.id));
  const rows = candidates.filter((b) => b.clientId == null || b.clientId === after.id);

  const plan = planBookingPatches(before, after, rows);
  const today = new Date().toISOString().slice(0, 10);
  let googleUpdated = 0;

  for (const { id, patch } of plan) {
    const [updated] = await db.update(bookings).set(patch).where(eq(bookings.id, id)).returning();
    if (!updated?.googleEventId) continue;
    if (updated.date < today || (updated.status !== "confirmed" && updated.status !== "pending_deposit")) continue;

    const [service] = await db.select().from(services).where(eq(services.id, updated.serviceId));
    const serviceName = service?.name ?? "Session";
    try {
      const ok = await updateCalendarEvent({
        eventId: updated.googleEventId,
        summary: `${serviceName} — ${updated.name}`,
        description: calendarEventDescription({ ...updated, serviceName }),
        date: updated.date,
        startTime: updated.startTime,
        durationMinutes: service?.durationMinutes ?? 60,
        attendeeEmail: updated.email,
      });
      if (ok) googleUpdated++;
    } catch (err) {
      console.error("[client-sync] could not update the Google event for booking", id, err);
    }
  }

  return { bookingsUpdated: plan.length, googleUpdated };
}

export const CONTACT_FIELDS = FIELDS;
