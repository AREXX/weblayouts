# Premium Quality Cuts — Booking backend

The booking flow on `premiumqualitycuts.html` now runs against a small serverless
API backed by a real database, so appointments are **shared across devices**,
availability is **server-authoritative** (no double-booking between two phones),
and the barber gets an **admin page** to manage the book. If the API is ever
unreachable, the page automatically falls back to the original on-device
(localStorage) flow, so it keeps working offline.

## What's in the repo

```
api/                     Vercel serverless functions (the API)
  _shop.js               services, hours, buffers  (mirror of window.PQC in the page)
  _db.js                 DB access — Neon Postgres in prod, PGlite locally
  _util.js               request helpers, PIN auth, ref generation
  services.js            GET  /api/services            catalogue + health check
  slots.js               GET  /api/slots?date&sid      open start-times for a day
  book.js                POST /api/book                create a booking (refuses overlaps)
  reschedule.js          POST /api/reschedule          move a booking (phone-verified)
  cancel.js              POST /api/cancel              cancel a booking (phone-verified)
  mine.js                GET  /api/mine?phone          a customer's upcoming appts (cross-device)
  admin.js               GET/POST /api/admin           barber view + actions (PIN-protected)
admin.html               the barber's appointment dashboard
premiumqualitycuts.html  customer page, wired to the API with offline fallback
scripts/                 local dev server + tests (not deployed)
```

## Deploy on Vercel (free)

You don't change how you deploy — push and Vercel builds it. Two one-time steps:

### 1. Create the database (Neon, free)

1. In your Vercel project → **Storage** → **Create Database** → **Neon** (Postgres).
2. Accept the defaults and connect it to this project.
3. Vercel injects a `DATABASE_URL` environment variable into your functions
   automatically. (The code also accepts `POSTGRES_URL`.) No schema step needed —
   the tables are created on first request.

### 2. Set the barber PIN

Project → **Settings** → **Environment Variables**:

| Name        | Value                    | Notes                                        |
|-------------|--------------------------|----------------------------------------------|
| `ADMIN_PIN` | *(a PIN you choose)*     | Protects `admin.html`. **Set this** — it defaults to `1234` if unset. |

Redeploy so the variables take effect. That's it:

- Customers book at `…/premiumqualitycuts.html`
- The barber manages bookings at `…/admin.html` (enter the PIN)

> **Note on Vercel's free tier:** Hobby is free but is intended for
> non-commercial use per Vercel's terms; a paying business may eventually need
> Vercel **Pro**. Neon's free database tier has no such restriction.

## Run it locally (no accounts, no database)

With no `DATABASE_URL`, the API uses **PGlite** (an in-process Postgres), so the
whole thing runs on your machine:

```bash
npm install
npm run dev            # → http://localhost:3000  (customer page + API)
```

Open <http://localhost:3000/premiumqualitycuts.html> and
<http://localhost:3000/admin.html> (PIN `1234` unless you set `ADMIN_PIN`).

## Tests

```bash
npm run test:api                       # API logic against in-process Postgres

# browser end-to-end (book / cross-device / reschedule / admin):
PORT=3100 ADMIN_PIN=4242 node scripts/dev-server.mjs &   # start server
PORT=3100 node scripts/test-e2e.mjs                       # run
```

## Keeping the menu in sync

The page renders the printed price menu from `window.PQC` (top of
`premiumqualitycuts.html`); the server mirrors the same services, durations,
deposits and hours in `api/_shop.js`. **If you change a service or the hours,
update both** so availability and pricing stay consistent. Service ids
(`s{group}_{item}`) must match between the two.

## Notes / limits

- **Double-booking:** each booking is written only if it doesn't overlap an
  existing one, which is more than enough for a single chair. (At extreme
  concurrency you'd add a per-day advisory lock; unnecessary at this scale.)
- **Cancel/reschedule auth:** a customer must supply the phone number on the
  booking, so a guessed reference alone can't touch someone else's appointment.
  The admin PIN bypasses this.
- **Notifications:** the page still offers the pre-filled SMS + calendar file.
  Automatic email/SMS on booking would need a provider (e.g. Twilio/Resend) and
  is not wired up.
