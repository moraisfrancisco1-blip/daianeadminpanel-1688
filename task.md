# Daiane Admin — Google Calendar bidirectional integration

## Context
- Original app lived in another Runable account (no credits). Cloned from GitHub:
  moraisfrancisco1-blip/daianeadminpanel-1688
- Provisioned fresh managed infra via app_init (/home/user/dai-oakes-admin) and copied
  its .env (Turso DB, BETTER_AUTH_SECRET, WEBSITE_URL, etc.) into the cloned project so it runs.
- FRESH EMPTY DATABASE — old account's data (81 clients, services) is NOT recoverable.
- Preview URL for this sandbox port 4200: https://daioake-d9dvacw-preview-4200.runable.site/
- Google OAuth redirect URI to register in Google Cloud Console:
  https://daioake-d9dvacw-preview-4200.runable.site/api/google-calendar/callback

## Implemented
- schema.ts: added bookings.googleEventId + new googleCalendarAuth table (tokens). db:push done.
- services/google-calendar.ts: OAuth URL, code exchange (stores refresh token), token auto-refresh,
  freeBusy read (getGoogleBusyIntervals), createCalendarEvent (sendUpdates=all + patient attendee).
- routes/google-calendar.ts: /connect (popup), /callback (popup HTML + postMessage), /status, /disconnect.
- index.ts: mounted /google-calendar.
- bookings.ts availability: merges Google busy intervals (non-blocking) into slot calc.
- bookings.ts free-service confirm + Stripe webhook: syncBookingToGoogleCalendar() creates event.
- reminders.tsx: Google Calendar card (connect popup / status / disconnect + success banner).

## Pending / notes for user
- Waiting on GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (ask_secrets).
- User MUST add the redirect URI above to the OAuth client in Google Cloud Console.
- RESEND_API_KEY + STRIPE keys are empty (fresh env) — emails/payments off until added.
- Need to create admin login + reseed services in fresh DB (data didn't migrate).
