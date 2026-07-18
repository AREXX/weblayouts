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

| Name             | Value                    | Notes                                        |
|------------------|--------------------------|----------------------------------------------|
| `ADMIN_PIN`      | *(a PIN you choose)*     | Protects `admin.html`. **Set this** — it defaults to `1234` if unset. |
| `CALENDAR_TOKEN` | *(a long random string)* | Secret in the Google Calendar feed URL (see §4). **Set this** — it defaults to `dev-calendar-token` if unset. Use something unguessable, e.g. a 32-char random string. |

Redeploy so the variables take effect. That's it:

- Customers book at `…/premiumqualitycuts.html`
- The barber manages bookings at `…/admin.html` (enter the PIN)

> **Note on Vercel's free tier:** Hobby is free but is intended for
> non-commercial use per Vercel's terms; a paying business may eventually need
> Vercel **Pro**. Neon's free database tier has no such restriction.

### 3. Email notifications (optional, free)

When a booking is made / moved / cancelled, the shop and the customer get an
email. This uses [Resend](https://resend.com) (free tier ~3k emails/month).
Without these variables the API simply skips email — everything else still works.

| Name             | Value                                              | Notes |
|------------------|----------------------------------------------------|-------|
| `RESEND_API_KEY` | *(from resend.com)*                                | Turns email on. |
| `SHOP_EMAIL`     | the barber's inbox, e.g. `rese@premiumqualitycuts.com` | Where shop notifications go. |
| `MAIL_FROM`      | `Premium Quality Cuts <booking@yourdomain.com>`    | Must be a Resend-verified sender. Until you verify a domain you can use `onboarding@resend.dev`, which only delivers to your own Resend account email (fine for testing). |

Which emails fire:

- **Customer books / reschedules / cancels** → email to the shop **and** to the
  customer (customer email only if they entered one — it's an optional field).
- **Barber confirms or cancels from `admin.html`** → email to the customer.

### 4. Google Calendar (subscribe to the appointment feed)

The API publishes a private calendar feed that Google Calendar (or Apple/Outlook)
can **subscribe** to — appointments then appear in your calendar automatically.

1. Set the `CALENDAR_TOKEN` env var (see §2) to a long random string and redeploy.
2. Open **`…/admin.html`**, enter your PIN — the top shows a **"Sync to Google
   Calendar"** box with your private feed URL and a Copy button.
3. In **Google Calendar** → left sidebar → **Other calendars → ＋ → From URL** →
   paste the link → **Add calendar**.

Notes:
- The link contains the secret token — **keep it private** (anyone with it can read
  the appointment list). Rotate it by changing `CALENDAR_TOKEN` and redeploying.
- It's **read-only** and Google refreshes subscribed URLs on its own schedule
  (typically within an hour, not instant). For instant/two-way sync you'd use the
  Google account OAuth approach instead.
- The feed shows active (booked/confirmed) appointments; cancellations drop off.

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
npm run test:notify                    # email composition + that /book fires Resend

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
- **Notifications:** automatic **email** to the shop + customer is wired up via
  Resend (see step 3 — enabled by setting the env vars). The page also still
  offers the pre-filled SMS + calendar file. Automatic **SMS** would need a paid
  provider (e.g. Twilio) and is not wired up.
