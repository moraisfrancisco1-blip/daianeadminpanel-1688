import { db } from "../database";
import { googleCalendarAuth } from "../database/schema";
import { eq } from "drizzle-orm";

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
  await db
    .update(googleCalendarAuth)
    .set({ selectedCalendarId: calendarId, updatedAt: new Date() })
    .where(eq(googleCalendarAuth.id, "primary"));
}

/** Lists every calendar on the connected Google account so the admin can pick which one to sync bookings to. */
export async function listCalendars(): Promise<
  { id: string; summary: string; primary: boolean; accessRole: string }[]
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
    items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }[];
  };
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride ?? c.summary ?? c.id,
    primary: !!c.primary,
    accessRole: c.accessRole ?? "",
  }));
}

export async function disconnectGoogleCalendar() {
  await db.delete(googleCalendarAuth).where(eq(googleCalendarAuth.id, "primary"));
}

/** Busy intervals (in minutes-of-day, Europe/Amsterdam) for the primary Google Calendar on the given date. */
export async function getGoogleBusyIntervals(dateISO: string): Promise<{ start: number; end: number }[]> {
  const token = await getValidAccessToken();
  if (!token) return [];
  const calendarId = await getSelectedCalendarId();

  // Build local-day start/end as UTC instants using the Europe/Amsterdam offset.
  const timeMin = `${dateISO}T00:00:00`;
  const timeMax = `${dateISO}T23:59:59`;

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: TZ,
      items: [{ id: calendarId }],
    }),
  });
  if (!res.ok) {
    console.error("[google-calendar] freeBusy failed", await res.text());
    return [];
  }
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  const busy = data.calendars?.[calendarId]?.busy ?? [];
  return busy.map((b) => ({
    start: isoTimeToMinutes(b.start),
    end: isoTimeToMinutes(b.end),
  }));
}

function isoTimeToMinutes(iso: string): number {
  // iso like 2026-07-21T14:30:00+02:00 or ...Z — extract the local wall-clock time
  // Google returns times already localized to the requested timeZone offset, so
  // parsing the HH:MM directly from the string (ignoring offset conversion) gives
  // the correct Europe/Amsterdam wall-clock minutes-of-day.
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
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
