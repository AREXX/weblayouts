// GET /api/calendar?token=SECRET
// A private iCalendar (.ics) feed of the shop's appointments that Google
// Calendar / Apple Calendar / Outlook can *subscribe* to ("Add calendar → From
// URL"). Read-only; the calendar app re-fetches it periodically. Protected by a
// secret token in the URL (calendar apps can't send auth headers), so the URL
// itself is the secret — keep it private, it's served over HTTPS.
import { handler, sendJson, query } from "./_util.js";
import { SHOP, shopNow } from "./_shop.js";
import { db } from "./_db.js";

const TOKEN = process.env.CALENDAR_TOKEN || "dev-calendar-token"; // set CALENDAR_TOKEN in production

function pad(n) { return (n < 10 ? "0" : "") + n; }
function icsEsc(s) { return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function stampUTC(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"; }
function localStamp(ymd, min) { const p = ymd.split("-"); return p[0] + p[1] + p[2] + "T" + pad(Math.floor(min / 60)) + pad(min % 60) + "00"; }

// Central Time (matches SHOP.tz) so events land at the right wall-clock time
// regardless of the viewer's own timezone.
const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:America/Chicago",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0500", "TZNAME:CDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600", "TZNAME:CST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

export default handler("GET", async (req, res) => {
  if ((query(req).token || "") !== TOKEN) return sendJson(res, 403, { ok: false, error: "Invalid calendar token" });

  const client = await db();
  // include a little history so recent appointments stay visible
  const t = shopNow().ymd.split("-");
  const cutoff = new Date(Date.UTC(+t[0], +t[1] - 1, +t[2]) - 60 * 86400000).toISOString().slice(0, 10);
  const { rows } = await client.query(
    `SELECT * FROM bookings WHERE status IN ('booked','confirmed') AND ymd >= $1 ORDER BY ymd, start_min`,
    [cutoff]
  );

  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Premium Quality Cuts//Booking//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsEsc(SHOP.name + " — Appointments"), "X-WR-TIMEZONE:America/Chicago",
    ...VTIMEZONE,
  ];
  for (const b of rows) {
    const desc = [
      "Client: " + b.name, "Phone: " + b.phone, b.email ? "Email: " + b.email : "",
      "Service: " + b.sname, "Ref: " + b.ref,
      Number(b.dep_num) ? "Deposit: $" + b.dep_num : "", b.notes ? "Notes: " + b.notes : "",
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      "UID:" + b.ref + "@premiumqualitycuts",
      "DTSTAMP:" + stampUTC(now),
      "DTSTART;TZID=America/Chicago:" + localStamp(b.ymd, b.start_min),
      "DTEND;TZID=America/Chicago:" + localStamp(b.ymd, b.start_min + b.dur_min),
      "SUMMARY:" + icsEsc(b.sname + " — " + b.name),
      "DESCRIPTION:" + icsEsc(desc),
      "LOCATION:" + icsEsc(SHOP.addr),
      "STATUS:" + (b.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"),
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Content-Disposition", 'inline; filename="premiumqualitycuts.ics"');
  res.end(lines.join("\r\n"));
});
