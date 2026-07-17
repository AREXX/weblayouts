// ---------------------------------------------------------------------------
// Shop configuration — the server's single source of truth for availability.
// Mirrors window.PQC in premiumqualitycuts.html (services, hours, buffers) so
// the API and the page agree on durations, deposits and open slots.
// If you change the printed menu on the page, mirror the change here.
// ---------------------------------------------------------------------------

export const SHOP = {
  name: "Premium Quality Cuts",
  tel: "+18327144153",
  telH: "(832) 714-4153",
  addr: "6850 Hwy 6 Ste 600, Missouri City, TX 77459",
  tz: "America/Chicago", // slot cut-offs ("no same-day within 90 min") use shop-local time
};

// Sun..Sat, open/close in minutes from midnight (null = closed)
export const SCHED = [null, null, [540, 1140], [540, 1140], [540, 1140], [450, 1140], [360, 900]];

export const STEP = 30;         // slot granularity (minutes)
export const STEP_BUFFER = 10;  // breathing room between appointments (minutes)
export const TODAY_LEAD = 90;   // no same-day slot within this many minutes from now

// Service catalogue — identical structure to the page's GROUPS.
// Service ids are generated as s{groupIndex}_{itemIndex}, matching the page.
const GROUPS = [
  { label: "The Cuts", items: [
    { name: "First Time Client", note: "Any haircut of your liking", price: "$30", dur: "50 min", dep: "$1 deposit (new clients)" },
    { name: "(Only on Wednesday) Wednesday Cuts", note: "Any haircut and style you desire", price: "$52", dur: "45 min", dep: "$2 deposit" },
    { name: "Rese-Static No Beard", note: "Shampoo, cut & finish — no facial hair touched", price: "$60", dur: "30 min", dep: "$5 deposit" },
    { name: "Rese-Static w/ Beard", note: "Shampoo, cut & razor beard line-up", price: "$60", dur: "40 min", dep: "$5 deposit" },
    { name: "Rese-Static with Enhancements", note: "Any haircut with enhancements on the hairline or beard", price: "$75", dur: "70 min", dep: "$10 deposit" },
    { name: "Rese-Static w/ Beard + Alaskan Mask Facial", note: "The full works — cut, beard & facial in one session", price: "$115", dur: "105 min", dep: "$40 deposit" },
    { name: "Under-Cut", note: "Precision fade, no frills", price: "$30", dur: "35 min", dep: "$5 deposit" },
    { name: "Line Up", note: "Edge sharpening, all ages — no trimming on top", price: "$30", dur: "30 min", dep: "$5 deposit" },
    { name: "Womens Taper", note: "", price: "$40", dur: "40 min", dep: "$10 deposit" },
    { name: "Senior Citizens Haircut", note: "(55 & up) Men and women", price: "$20", dur: "35 min", dep: "" },
    { name: "Shampoo", note: "", price: "$25", dur: "15 min", dep: "$12 deposit" },
  ]},
  { label: "Beard & Facial", items: [
    { name: "Beard Work", note: "Deep cleanse, exfoliant & conditioning, razor lining finish", price: "$45", dur: "40 min", dep: "$5 deposit" },
    { name: "Alaskan Mask Facial", note: "Mint cleanse, steam & cold mask", price: "$65", dur: "50 min", dep: "$32.50 deposit" },
  ]},
  { label: "Kids & Family", items: [
    { name: "Kids Haircut (1–13)", note: "Any style, done right", price: "$30", dur: "35 min", dep: "$1 deposit" },
    { name: "Young Men Haircut (14–17)", note: "", price: "$40", dur: "40 min", dep: "$5 deposit" },
    { name: "2 Kids (1–13)", note: "", price: "$60", dur: "70 min", dep: "$30 deposit" },
    { name: "1 Adult + 1 Kid (13 & under)", note: "", price: "$87", dur: "75 min", dep: "$17 deposit" },
    { name: "1 Adult + 3 Kids (13 & under)", note: "", price: "$147", dur: "120 min", dep: "$75 deposit" },
  ]},
  { label: "On Location", items: [
    { name: "House Call", note: "We bring the shop to you", price: "$125+", dur: "210 min", dep: "$65 deposit" },
  ]},
];

function money(s) { const m = String(s || "").match(/([\d]+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; }
function mins(s) { const m = String(s || "").match(/(\d+)\s*min/); return m ? parseInt(m[1], 10) : 30; }

// Flattened services with stable ids — the list the API and page both key off.
export const SERVICES = [];
GROUPS.forEach((g, gi) => g.items.forEach((it, ii) => {
  SERVICES.push({
    id: "s" + gi + "_" + ii, group: g.label, name: it.name, note: it.note || "",
    price: it.price, priceNum: money(it.price), dur: it.dur, durMin: mins(it.dur),
    dep: it.dep || "", depNum: money(it.dep),
  });
}));

export function svc(id) { return SERVICES.find((s) => s.id === id) || null; }

// ---- date helpers (shop-local) ----
function pad(n) { return (n < 10 ? "0" : "") + n; }

// "now" in the shop's timezone → { ymd, minutes-since-midnight }
export function shopNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP.tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  let hh = g("hour"); if (hh === "24") hh = "00";
  return { ymd: g("year") + "-" + g("month") + "-" + g("day"), min: parseInt(hh, 10) * 60 + parseInt(g("minute"), 10) };
}

// day-of-week (0=Sun) for a 'YYYY-MM-DD' string, timezone-independent
export function dowOf(ymd) {
  const p = ymd.split("-");
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
}

export function isValidYmd(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dowOf(s) >= 0; }

// Open start-times for a service on a given date, given the day's existing
// (non-cancelled) bookings. `busy` = [{ start, durMin }]. Mirrors the page's slotsFor().
export function computeSlots(ymd, durMin, busy) {
  const sc = SCHED[dowOf(ymd)];
  if (!sc) return [];
  const [open, close] = sc;
  const now = shopNow();
  const isToday = now.ymd === ymd;
  const out = [];
  for (let t = open; t + durMin <= close; t += STEP) {
    if (isToday && t < now.min + TODAY_LEAD) continue;
    const end = t + durMin;
    let clash = false;
    for (const b of busy) {
      const bEnd = b.start + b.durMin;
      if (t < bEnd + STEP_BUFFER && end + STEP_BUFFER > b.start) { clash = true; break; }
    }
    if (!clash) out.push(t);
  }
  return out;
}
