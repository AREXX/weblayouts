// POST /api/book
// Receives a booking from the Premium Quality Cuts in-page booking engine,
// reserves the slot on Google Calendar, and emails Rese. No payment step.
const {
  TZ, CALENDAR_ID, calendarClient, localToInstant,
} = require('./_google');

const pad = (n) => (n < 10 ? '0' : '') + n;
const hhmm = (min) => pad(Math.floor(min / 60)) + ':' + pad(min % 60);
const fmt12 = (min) => {
  let h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + pad(m) + ' ' + ap;
};

// Best-effort email via Resend. Never throws — a notification failure must not
// lose the booking (it's already on the calendar).
async function notify(b) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.BOOKING_EMAIL_TO;
  const from = process.env.BOOKING_EMAIL_FROM || 'Bookings <onboarding@resend.dev>';
  if (!key || !to) return false;
  const when = `${b.ymd} · ${fmt12(b.start)}–${fmt12(b.start + b.durMin)}`;
  const rows = [
    ['Service', b.service],
    ['When', when],
    ['Name', b.name],
    ['Mobile', b.phone],
    ['Email', b.email || '—'],
    ['Notes', b.notes || '—'],
    ['Price', b.price || '—'],
    ['Ref', b.ref],
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#888">${k}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`).join('');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#201e1d">
    <h2 style="margin:0 0 4px">New appointment request</h2>
    <p style="margin:0 0 16px;color:#888">Premium Quality Cuts · added to your calendar</p>
    <table>${rows}</table></div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `New booking — ${b.name} · ${when}`, html }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const b = req.body || {};
  // minimal validation
  const missing = ['ymd', 'start', 'durMin', 'name', 'phone', 'service']
    .filter((k) => b[k] === undefined || b[k] === null || b[k] === '');
  if (missing.length) return res.status(400).json({ error: 'Missing fields', fields: missing });
  b.start = Number(b.start); b.durMin = Number(b.durMin);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.ymd) || isNaN(b.start) || isNaN(b.durMin)) {
    return res.status(400).json({ error: 'Bad date/time' });
  }

  const cal = calendarClient();
  if (!cal) {
    // Backend not configured yet — tell the client so it can fall back to
    // the local-only confirmation instead of pretending it reached the shop.
    return res.status(503).json({ ok: false, error: 'Calendar not configured' });
  }

  const startInstant = localToInstant(b.ymd, b.start, TZ);
  const endInstant = localToInstant(b.ymd, b.start + b.durMin, TZ);

  try {
    // Guard against a double-book race: re-check the exact slot is still free.
    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin: startInstant.toISOString(),
        timeMax: endInstant.toISOString(),
        items: [{ id: CALENDAR_ID }],
      },
    });
    const busy = (((fb.data.calendars || {})[CALENDAR_ID] || {}).busy) || [];
    if (busy.length) return res.status(409).json({ ok: false, error: 'Slot just taken' });

    const event = await cal.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `${b.service} — ${b.name}`,
        description:
          `Booked via website.\n` +
          `Name: ${b.name}\nMobile: ${b.phone}\n` +
          (b.email ? `Email: ${b.email}\n` : '') +
          (b.notes ? `Notes: ${b.notes}\n` : '') +
          (b.price ? `Price: ${b.price}\n` : '') +
          `Ref: ${b.ref || '—'}`,
        start: { dateTime: `${b.ymd}T${hhmm(b.start)}:00`, timeZone: TZ },
        end: { dateTime: `${b.ymd}T${hhmm(b.start + b.durMin)}:00`, timeZone: TZ },
      },
    });

    const emailed = await notify(b);
    return res.status(200).json({ ok: true, ref: b.ref, eventId: event.data.id, emailed });
  } catch (e) {
    console.error('book error', e && e.message);
    return res.status(502).json({ ok: false, error: 'Could not reserve' });
  }
};
