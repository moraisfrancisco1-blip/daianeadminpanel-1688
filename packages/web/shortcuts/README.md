# iPhone shortcuts

All endpoints live under `/api/shortcuts` and need `Authorization: Bearer <SHORTCUTS_TOKEN>`
(env var in Vercel; changing it revokes the phone). Every call is written to the Audit Log.

| Endpoint | Use |
|---|---|
| `GET /today` | today's sessions (first name + time) |
| `GET /stats` | revenue today/week, overdue, awaiting |
| `GET /packages-expiring` | packages to renew (first name + counts) |
| `GET /next` | next client + active package / pending payment (`summary` is speakable) |
| `GET /clients?q=` | client picker (`id`, `name`) |
| `POST /payment-link` `{clientId}` | durable payment link for the client's latest unpaid invoice |
| `GET /services` | active services (`id`, `name`, `price`, `durationMinutes`) |
| `POST /book` `{clientId, serviceId, date, startTime}` | books a session (same rules as the panel: availability, invoice draft, confirmation emails); `409` if the slot is taken |
| `POST /complete-session` | marks today's most recent started session as completed |
| `GET /briefing` | 7:00 summary text (`summary`) |
| `POST /expense-scan` (form field `file`) | receipt -> expense flagged "REVER" |

Widgets: `agenda-widget.js`, `packages-widget.js` (Scriptable).

## Shortcut "Próxima cliente"
1. Get contents of URL: GET `.../api/shortcuts/next`, header `Authorization: Bearer <token>`.
2. Get dictionary value `summary`.
3. Speak text (or Show result).

## Shortcut "Link de pagamento"
1. Ask for input (text): "Nome da cliente".
2. Get contents of URL: GET `.../api/shortcuts/clients?q=<input>`; Get dictionary value `clients`.
3. Choose from list (item name = `name`); Get `id` of the chosen item.
4. Get contents of URL: POST `.../api/shortcuts/payment-link`, request body JSON `{"clientId": <id>}`.
5. Get `url`, `phone`, `firstName`, `invoiceNumber`; build the message text, then open
   `https://wa.me/<phone digits>?text=<URL-encoded message>` (use "URL Encode" on the message).

## Shortcut "Marcar sessão"
1. Ask for input "Nome da cliente" -> `GET /clients?q=` -> Choose from list -> `id`.
2. `GET /services` -> Choose from list (show `name`) -> `id`.
3. Ask for date (Ask for input, type Date) -> Format date `yyyy-MM-dd`; ask for time -> Format `HH:mm`.
4. `POST /book` with JSON `{"clientId":..,"serviceId":..,"date":"..","startTime":".."}` -> show `summary`.
Note: like a booking made in the panel, this emails the client and Daiane a confirmation and creates a draft invoice.

## Automation "Resumo às 7h"
Time of day 07:00 -> Get contents of URL `GET /briefing` -> Get `summary` -> Show notification.

## Automation "Fim de sessão" (NFC tag)
When the NFC tag is scanned -> `POST /complete-session` -> Show notification `summary`.
It only marks the session completed. Package sessions are deducted when the booking is made, and the
Google-review email is already sent automatically after the session by the existing reminders cron, so
nothing is deducted or sent twice.

## Automation "Chegada à clínica"
Arrive at location -> run the Scriptable agenda widget script (or `GET /today`) -> Set Focus: Work.
Real-time alerts (new booking / Stripe payment) need a Pushcut or ntfy account and are not built yet.
