// Shared Google auth + small timezone helpers for the booking backend.
// Files in api/ that start with "_" are NOT exposed as routes by Vercel,
// so this is a safe place for shared code.
const { google } = require('googleapis');

const TZ = process.env.SHOP_TZ || 'America/Chicago';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

// Build an authenticated Calendar client from the service-account env vars.
// GOOGLE_PRIVATE_KEY is stored with literal "\n" sequences in Vercel, so we
// turn them back into real newlines here.
function calendarClient() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) return null; // caller decides how to degrade
  const auth = new google.auth.JWT(email, null, key, [
    'https://www.googleapis.com/auth/calendar',
  ]);
  return google.calendar({ version: 'v3', auth });
}

// Minutes that the given instant is EAST of UTC, in the shop timezone.
// e.g. Chicago in summer (CDT) -> -300.
function tzOffset(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Convert a local wall-clock time ("YYYY-MM-DD" + minutes-from-midnight) in the
// shop timezone to the exact UTC instant. Two passes keep it correct across a
// DST boundary.
function localToInstant(ymd, minutes, tz) {
  const [Y, M, D] = ymd.split('-').map(Number);
  const h = Math.floor(minutes / 60), mi = minutes % 60;
  const base = () => Date.UTC(Y, M - 1, D, h, mi, 0);
  let ts = base() - tzOffset(new Date(base()), tz) * 60000;
  ts = base() - tzOffset(new Date(ts), tz) * 60000;
  return new Date(ts);
}

// The hour:minute of an instant, in the shop timezone, as minutes from midnight.
function instantToLocalMinutes(instant, tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant).reduce((a, x) => (a[x.type] = x.value, a), {});
  return (+p.hour) * 60 + (+p.minute);
}

module.exports = {
  TZ, CALENDAR_ID, calendarClient, tzOffset, localToInstant, instantToLocalMinutes,
};
