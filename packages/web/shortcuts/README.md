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
