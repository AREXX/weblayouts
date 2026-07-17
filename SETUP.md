# Appointment backend — setup

Replaces the paid booking platform with **your own site + Google Calendar + email**.
No monthly fee, no payment step. When a customer books on the Premium Quality
Cuts page:

1. the slot is written to **Google Calendar** (your appointment book), and
2. **Rese gets an email** the moment it happens, and
3. that slot is then **greyed out for the next customer** (real double-book
   protection across devices, read live from the calendar).

Everything runs as two tiny Vercel functions in `/api`. If the backend is ever
unreachable, the page still confirms locally like before — nothing breaks.

---

## 1. Google Calendar (the appointment book)

We use a **service account** — a robot Google identity that writes events into
Rese's calendar. No OAuth login popup for customers.

1. Go to <https://console.cloud.google.com/> → create a project (e.g.
   `pqc-booking`).
2. **APIs & Services → Library →** search **Google Calendar API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   Name it `booking-bot`, create it, no roles needed.
4. Open the service account → **Keys → Add key → Create new key → JSON.**
   A JSON file downloads. Inside it you'll use two fields:
   - `client_email`  → `GOOGLE_CLIENT_EMAIL`
   - `private_key`   → `GOOGLE_PRIVATE_KEY`
5. **Share the calendar with the bot.** In Google Calendar (as Rese), open the
   calendar you want bookings in → **Settings and sharing → Share with specific
   people → Add** the service account's `client_email` → permission
   **"Make changes to events"**.
6. On that same settings page, copy the **Calendar ID** (looks like
   `...@group.calendar.google.com`, or `primary` for the main calendar) →
   `GOOGLE_CALENDAR_ID`.

> Tip: make a **dedicated** "Appointments" calendar so bookings stay separate
> from Rese's personal events. He'll still see it (and get reminders) in the
> Google Calendar app on his phone, including iPhone.

## 2. Email notifications (Resend)

1. Sign up at <https://resend.com> (free tier is plenty).
2. **API Keys → Create** → copy it → `RESEND_API_KEY`.
3. Set `BOOKING_EMAIL_TO` to the address Rese wants alerts at.
4. `BOOKING_EMAIL_FROM` can stay `onboarding@resend.dev` to start. To send from
   your own domain, verify it in Resend first, then use
   `Premium Quality Cuts <bookings@yourdomain.com>`.

## 3. Add the environment variables in Vercel

Vercel → your project → **Settings → Environment Variables** → add each name
from [`.env.example`](./.env.example) (Production + Preview). For
`GOOGLE_PRIVATE_KEY`, paste the whole value **including** the `\n` sequences and
wrap it in quotes.

Then **redeploy** so the functions pick up the new variables.

## 4. Test

- Visit the live site, book a test appointment.
- You should see the event appear on the Google Calendar and an email arrive.
- Book the same time again from a different browser — the slot should now be
  greyed out.

---

## Cost

- Vercel: free Hobby tier works for testing. Vercel's terms reserve Hobby for
  non-commercial use, so for a real business use **Pro ($20/mo)** — still far
  under the old platform. (Alternatively the two `/api` functions can be moved
  to Cloudflare Workers, whose free tier permits commercial use.)
- Google Calendar: free.
- Resend: free tier covers thousands of emails/month.

## Where things live

| File | Purpose |
|------|---------|
| `api/book.js` | Receives a booking, writes the calendar event, emails Rese |
| `api/availability.js` | Returns busy times so taken slots grey out |
| `api/_google.js` | Shared Google auth + timezone helpers |
| `premiumqualitycuts.html` | The booking UI (calls the two functions above) |
