// ---------------------------------------------------------------------------
// Booking email notifications via Resend (https://resend.com). Best-effort:
// sending never blocks or fails a booking, and the whole module no-ops when
// RESEND_API_KEY is unset, so the API works fine before email is configured.
//
// Env:
//   RESEND_API_KEY  Resend API key (enables sending)
//   MAIL_FROM       verified sender, e.g. "Premium Quality Cuts <booking@yourshop.com>"
//                   (defaults to Resend's onboarding@resend.dev sandbox sender)
//   SHOP_EMAIL      where shop notifications go (the barber's inbox)
// ---------------------------------------------------------------------------
import { SHOP } from "./_shop.js";

const KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.MAIL_FROM || "Premium Quality Cuts <onboarding@resend.dev>";
// shop inbox for booking notifications — override with the SHOP_EMAIL env var
const SHOP_EMAIL = process.env.SHOP_EMAIL || "ar3x4work@gmail.com";

export function notifyEnabled() { return !!KEY; }

// ---- formatting (shop-local, independent of server tz) ----
function fmtMin(m) { const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "PM" : "AM", hh = h % 12 || 12; return hh + (mm ? ":" + ("0" + mm).slice(-2) : "") + " " + ap; }
function prettyDate(ymd) {
  const p = String(ymd).split("-");
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function money(n) { n = Number(n) || 0; return "$" + (n % 1 ? n.toFixed(2) : n); }

const HEAD = {
  booked: { shop: "New booking", cust: "You're booked at " + SHOP.name },
  reschedule: { shop: "Booking moved", cust: "Your appointment was moved" },
  cancel: { shop: "Booking cancelled", cust: "Your appointment was cancelled" },
  confirmed: { shop: "Booking confirmed", cust: "Your appointment is confirmed" },
};

function lines(b) {
  const rows = [
    ["Service", b.sname],
    ["When", prettyDate(b.ymd) + " at " + fmtMin(b.start)],
    ["With", "Rese the Barber"],
    ["Name", b.name],
    ["Phone", b.phone],
    ["Reference", b.ref],
  ];
  if (b.email) rows.push(["Email", b.email]);
  if (Number(b.depNum)) rows.push(["Deposit", money(b.depNum)]);
  if (b.notes) rows.push(["Notes", b.notes]);
  if (b.prevYmd != null && b.prevStart != null) rows.push(["Previously", prettyDate(b.prevYmd) + " at " + fmtMin(b.prevStart)]);
  return rows;
}

function textBody(intro, b) {
  return intro + "\n\n" + lines(b).map(([k, v]) => k + ": " + v).join("\n") + "\n\n— " + SHOP.name + " · " + SHOP.telH;
}
function htmlBody(intro, b) {
  const rows = lines(b).map(([k, v]) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#6b6663;font:600 13px/1.4 system-ui">${esc(k)}</td>` +
    `<td style="padding:6px 0;font:700 14px/1.4 system-ui;color:#201e1d">${esc(v)}</td></tr>`).join("");
  return `<div style="max-width:520px;margin:0 auto;font-family:system-ui,sans-serif;color:#201e1d">
    <div style="background:#201e1d;color:#f3f2f2;padding:18px 20px;border-radius:12px 12px 0 0">
      <div style="font:800 10px/1 system-ui;letter-spacing:.16em;text-transform:uppercase;color:#d9a520">${esc(SHOP.name)}</div>
      <div style="font:800 18px/1.2 system-ui;margin-top:5px">${esc(intro)}</div>
    </div>
    <div style="border:1px solid #e6e4e3;border-top:0;border-radius:0 0 12px 12px;padding:18px 20px">
      <table style="border-collapse:collapse">${rows}</table>
    </div>
    <p style="font:500 12px/1.5 system-ui;color:#8a8582;margin:14px 2px">${esc(SHOP.name)} · ${esc(SHOP.telH)} · ${esc(SHOP.addr)}</p>
  </div>`;
}

// Pure — build the list of {to, subject, text, html} messages for an event.
// Kept side-effect-free so it can be unit-tested without a network or key.
export function buildEmails(kind, b, opts = {}) {
  const toShop = opts.toShop !== false;
  const toCustomer = opts.toCustomer !== false;
  const h = HEAD[kind] || HEAD.booked;
  const out = [];

  if (toShop && SHOP_EMAIL) {
    const introShop = h.shop + " · " + b.sname + " · " + prettyDate(b.ymd) + " " + fmtMin(b.start);
    out.push({ to: SHOP_EMAIL, subject: h.shop + " — " + b.name + " · " + fmtMin(b.start) + " " + prettyDate(b.ymd),
      text: textBody(introShop, b), html: htmlBody(introShop, b) });
  }
  if (toCustomer && b.email) {
    const introCust = h.cust;
    out.push({ to: b.email, subject: h.cust + " · " + SHOP.name,
      text: textBody(introCust, b), html: htmlBody(introCust, b) });
  }
  return out;
}

async function sendOne(msg) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!r.ok) throw new Error("Resend " + r.status + ": " + (await r.text().catch(() => "")));
}

// Fire notifications for an event. Never throws — email problems must not break
// the booking. Returns the number of messages actually sent.
export async function notify(kind, booking, opts) {
  if (!KEY) return 0;
  const msgs = buildEmails(kind, booking, opts);
  const results = await Promise.allSettled(msgs.map(sendOne));
  let sent = 0;
  results.forEach((res) => {
    if (res.status === "fulfilled") sent++;
    else console.error("[notify] email failed:", res.reason && res.reason.message ? res.reason.message : res.reason);
  });
  return sent;
}
