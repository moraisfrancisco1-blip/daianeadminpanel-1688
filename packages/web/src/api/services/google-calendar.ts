import { db } from "../database";
import { googleCalendarAuth } from "../database/schema";
import { eq } from "drizzle-orm";
import { eventToDaySegments, shiftDate, type GoogleEventLike } from "../lib/busy-intervals";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const TZ = "Europe/Amsterdam";

function redirectUri() {
  const base = (process.env.WEBSITE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/google-calendar/callback`;
}

export function isGoogleCalendarConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

export function getGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/calendar",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function fetchGoogleProfile(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID ?? "",
      client_secret: CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Revoke access at myaccount.google.com/permissions and reconnect.",
    );
  }
  const email = await fetchGoogleProfile(data.access_token);
  const expiryDate = new Date(Date.now() + data.expires_in * 1000);

  await db
    .insert(googleCalendarAuth)
    .values({
      id: "primary",
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiryDate,
      connectedEmail: email,
    })
    .onConflictDoUpdate({
      target: googleCalendarAuth.id,
      set: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiryDate,
        connectedEmail: email,
        updatedAt: new Date(),
      },
    });
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID ?? "",
      client_secret: CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${text}`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

/** Returns a valid access token, refreshing it first if it's expired or about to expire. Null if not connected. */
export async function getValidAccessToken(): Promise<string | null> {
  if (!isGoogleCalendarConfigured()) return null;
  const [row] = await db.select().from(googleCalendarAuth).where(eq(googleCalendarAuth.id, "primary"));
  if (!row) return null;

  const expiringSoon = row.expiryDate.getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiringSoon) return row.accessToken;

  const refreshed = await refreshAccessToken(row.refreshToken);
  const expiryDate = new Date(Date.now() + refreshed.expires_in * 1000);
  await db
    .update(googleCalendarAuth)
    .set({ accessToken: refreshed.access_token, expiryDate, updatedAt: new Date() })
    .where(eq(googleCalendarAuth.id, "primary"));
  return refreshed.access_token;
}

export async function getGoogleCalendarStatus() {
  const [row] = await db.select().from(googleCalendarAuth).where(eq(googleCalendarAuth.id, "primary"));
  return {
    configured: isGoogleCalendarConfigured(),
    connected: !!row,
    email: row?.connectedEmail ?? null,
    selectedCalendarId: row?.selectedCalendarId ?? "primary",
  };
}

/** Returns the calendar id that bookings should be written to / read from. Defaults to "primary". */
export async function getSelectedCalendarId(): Promise<string> {
  const [row] = await db.select().from(googleCalendarAuth).where(eq(googleCalendarAuth.id, "primary"));
  return row?.selectedCalendarId ?? "primary";
}

export async function setSelectedCalendarId(calendarId: string) {
  writableCache = null;
  await db
    .update(googleCalendarAuth)
    .set({ selectedCalendarId: calendarId, updatedAt: new Date() })
    .where(eq(googleCalendarAuth.id, "primary"));
}

/** Lists every calendar on the connected Google account so the admin can pick which one to sync bookings to. */
export async function listCalendars(): Promise<
  { id: string; summary: string; primary: boolean; accessRole: string; selected: boolean }[]
> {
  const token = await getValidAccessToken();
  if (!token) return [];
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    console.error("[google-calendar] calendarList failed", await res.text());
    return [];
  }
  const data = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      summaryOverride?: string;
      primary?: boolean;
      accessRole?: string;
      selected?: boolean;
    }[];
  };
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: (c.summaryOverride ?? c.summary ?? c.id).trim(),
    primary: !!c.primary,
    accessRole: c.accessRole ?? "",
    // Google omits the flag when the calendar is unticked in its sidebar.
    selected: !!c.selected,
  }));
}

type WritableCalendar = { id: string; name: string; primary: boolean; visible: boolean };
type CalendarRef = { id: string; name: string };

let writableCache: { at: number; calendars: WritableCalendar[] } | null = null;
const CALENDAR_CACHE_MS = 5 * 60 * 1000;

/**
 * Calendars on the account that Daiane can write to. Cached for a few minutes:
 * public availability needs this on every request. A failed lookup is not cached.
 */
async function writableCalendars(): Promise<WritableCalendar[]> {
  if (writableCache && Date.now() - writableCache.at < CALENDAR_CACHE_MS) return writableCache.calendars;
  const calendars = (await listCalendars())
    .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
    .map((c) => ({ id: c.id, name: c.summary, primary: c.primary, visible: c.selected }));
  if (calendars.length > 0) writableCache = { at: Date.now(), calendars };
  return calendars;
}

/** The booking calendar's real id ("primary" is only an alias for the account's own calendar). */
async function bookingCalendarId(writable: WritableCalendar[]): Promise<string> {
  const selectedId = await getSelectedCalendarId();
  const primary = writable.find((c) => c.primary);
  return selectedId === "primary" && primary ? primary.id : selectedId;
}

/**
 * Calendars whose events make Daiane busy: every calendar of hers that is ticked
 * in Google Calendar (what she sees there is what blocks online booking), her main
 * calendar, and the one bookings are written to. Read-only ones (holidays,
 * birthdays) and unticked ones are ignored. If the list can't be read, falls back
 * to the main + booking calendars.
 */
async function calendarsToRead(): Promise<CalendarRef[]> {
  const writable = await writableCalendars();
  const bookingId = await bookingCalendarId(writable);
  const out = new Map<string, CalendarRef>();
  for (const c of writable) {
    if (c.visible || c.primary || c.id === bookingId) out.set(c.id, { id: c.id, name: c.name });
  }
  if (writable.length === 0) out.set("primary", { id: "primary", name: "Google Calendar" });
  if (!out.has(bookingId)) out.set(bookingId, { id: bookingId, name: bookingId });
  return [...out.values()];
}

/**
 * Where to look for an event that already exists: the booking calendar first, then her
 * other calendars. An event stays on the calendar it was created on even if the booking
 * calendar is changed later, so touching it only on the current one leaves it behind.
 */
async function calendarIdsForExistingEvent(): Promise<string[]> {
  const writable = await writableCalendars();
  const first = await bookingCalendarId(writable);
  return [first, ...writable.map((c) => c.id).filter((id) => id !== first)];
}

export async function disconnectGoogleCalendar() {
  writableCache = null;
  await db.delete(googleCalendarAuth).where(eq(googleCalendarAuth.id, "primary"));
}

export type GoogleBlock = {
  eventId: string;
  summary: string;
  date: string; // YYYY-MM-DD
  startMin: number;
  endMin: number;
  allDay: boolean;
  calendarName: string;
};

/**
 * Events that make Daiane busy between two dates (inclusive), from all her visible
 * calendars (see calendarsToRead), split into per-day blocks for the admin
 * calendar. `connected: false` means Google isn't linked (nothing to show).
 * Throws if Google can't be read, so the caller can tell the admin.
 */
export async function getGoogleEventBlocks(
  fromISO: string,
  toISO: string,
): Promise<{ connected: boolean; blocks: GoogleBlock[] }> {
  const token = await getValidAccessToken();
  if (!token) return { connected: false, blocks: [] };
  const calendars = await calendarsToRead();

  const seen = new Set<string>();
  const blocks: GoogleBlock[] = [];
  for (const { id: calendarId, name: calendarName } of calendars) {
    let pageToken: string | undefined;
    for (let page = 0; page < 4; page++) {
      const params = new URLSearchParams({
        timeMin: `${shiftDate(fromISO, -1)}T00:00:00Z`,
        timeMax: `${shiftDate(toISO, 2)}T00:00:00Z`,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        timeZone: TZ,
        fields: "nextPageToken,items(id,summary,status,transparency,start,end)",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`Google events.list failed for ${calendarId} (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as { items?: GoogleEventLike[]; nextPageToken?: string };
      for (const ev of data.items ?? []) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        for (const seg of eventToDaySegments(ev, fromISO, toISO)) {
          blocks.push({ eventId: ev.id, summary: ev.summary?.trim() || "Busy", calendarName, ...seg });
        }
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
  }
  return { connected: true, blocks };
}

const DAINE_EMAIL = "daiane.oakes@gmail.com";

export async function createCalendarEvent(params: {
  bookingId: number;
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  durationMinutes: number;
  attendeeEmail: string;
}): Promise<string | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  const calendarId = await getSelectedCalendarId();

  const startDateTime = `${params.date}T${params.startTime}:00`;
  const [h, m] = params.startTime.split(":").map(Number);
  const endTotal = h! * 60 + m! + params.durationMinutes;
  const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
  const endDateTime = `${params.date}T${endTime}:00`;

  // Build attendees list: patient + Daiane (if patient email is different from Daiane's)
  const attendees: { email: string }[] = [{ email: params.attendeeEmail }];
  if (params.attendeeEmail.toLowerCase() !== DAINE_EMAIL.toLowerCase()) {
    attendees.push({ email: DAINE_EMAIL });
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: params.summary,
        description: params.description,
        start: { dateTime: startDateTime, timeZone: TZ },
        end: { dateTime: endDateTime, timeZone: TZ },
        attendees,
        reminders: { useDefault: true },
      }),
    },
  );
  if (!res.ok) {
    console.error("[google-calendar] createEvent failed", await res.text());
    return null;
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Deletes a Google Calendar event by its event ID.
 * No-ops silently if Google Calendar isn't connected or the event doesn't exist.
 */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const token = await getValidAccessToken();
  if (!token) return false;

  try {
    for (const calendarId of await calendarIdsForExistingEvent()) {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (res.ok || res.status === 410) return true; // 410: already gone
      if (res.status !== 404) {
        console.error("[google-calendar] deleteEvent failed", res.status, await res.text());
        return false;
      }
      // 404: not on this calendar — try her other ones.
    }
    console.error("[google-calendar] deleteEvent: event not found on any calendar", eventId);
    return false;
  } catch (err) {
    console.error("[google-calendar] deleteEvent error", err);
    return false;
  }
}

/**
 * Updates a Google Calendar event with new details.
 * No-ops silently if Google Calendar isn't connected or the event doesn't exist.
 */
export async function updateCalendarEvent(params: {
  eventId: string;
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  durationMinutes: number;
  attendeeEmail: string;
}): Promise<boolean> {
  const token = await getValidAccessToken();
  if (!token) return false;

  const startDateTime = `${params.date}T${params.startTime}:00`;
  const [h, m] = params.startTime.split(":").map(Number);
  const endTotal = h! * 60 + m! + params.durationMinutes;
  const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
  const endDateTime = `${params.date}T${endTime}:00`;

  // Build attendees list: patient + Daiane (if patient email is different from Daiane's)
  const attendees: { email: string }[] = [{ email: params.attendeeEmail }];
  if (params.attendeeEmail.toLowerCase() !== DAINE_EMAIL.toLowerCase()) {
    attendees.push({ email: DAINE_EMAIL });
  }

  const body = JSON.stringify({
    summary: params.summary,
    description: params.description,
    start: { dateTime: startDateTime, timeZone: TZ },
    end: { dateTime: endDateTime, timeZone: TZ },
    attendees,
    reminders: { useDefault: true },
  });

  try {
    for (const calendarId of await calendarIdsForExistingEvent()) {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}?sendUpdates=all`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body,
        },
      );
      if (res.ok) return true;
      if (res.status !== 404) {
        console.error("[google-calendar] updateEvent failed", res.status, await res.text());
        return false;
      }
      // 404: not on this calendar — try her other ones.
    }
    console.error("[google-calendar] updateEvent: event not found on any calendar", params.eventId);
    return false;
  } catch (err) {
    console.error("[google-calendar] updateEvent error", err);
    return false;
  }
}
