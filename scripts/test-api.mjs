// Exercises the booking API end-to-end against PGlite (in-process Postgres).
// Run: node scripts/test-api.mjs
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
process.env.ADMIN_PIN = "4242";

const load = async (n) => (await import(pathToFileURL(join(ROOT, "api", n + ".js")).href)).default;

// invoke a handler with a mock req/res, return { status, body }
function call(fn, { method = "GET", query = {}, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, query, body, headers, url: "/", [Symbol.asyncIterator]: async function* () {} };
    const res = {
      statusCode: 200, _headers: {}, writableEnded: false,
      setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
      end(s) {
        this.writableEnded = true;
        let body = null; try { body = s ? JSON.parse(s) : null; } catch { /* non-JSON (e.g. iCalendar) */ }
        resolve({ status: this.statusCode, text: s || "", body });
      },
    };
    Promise.resolve(fn(req, res)).catch(reject);
  });
}

const dowOf = (ymd) => { const p = ymd.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); };
const SCHED = [null, null, [540, 1140], [540, 1140], [540, 1140], [450, 1140], [360, 900]];
function nextOpenDate(daysAhead = 4) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  for (let i = 0; i < 14; i++) {
    const ymd = d.toISOString().slice(0, 10);
    if (SCHED[dowOf(ymd)]) return ymd;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  throw new Error("no open date found");
}

let passed = 0;
const ok = (label, cond) => { assert.ok(cond, "FAIL: " + label); console.log("  ✓ " + label); passed++; };

const run = async () => {
  const [services, slots, book, reschedule, cancel, mine, admin] =
    await Promise.all(["services", "slots", "book", "reschedule", "cancel", "mine", "admin"].map(load));

  const SID = "s0_7"; // Line Up, 30 min
  const PHONE = "(832) 555-0100";
  const DATE = nextOpenDate();

  // services
  let r = await call(services);
  ok("GET /services returns catalogue", r.status === 200 && r.body.services.length > 15);

  // slots available
  r = await call(slots, { query: { sid: SID, date: DATE } });
  ok("GET /slots returns open times", r.status === 200 && Array.isArray(r.body.slots) && r.body.slots.length > 0);
  // pick two slots far enough apart (>=60 min) that neither buffers into the other
  const slot = r.body.slots[0];
  const neighbour = r.body.slots.find((t) => t - slot >= 60);
  ok("day has two independent slots for the test", neighbour != null);

  // bad inputs
  ok("book rejects missing name", (await call(book, { method: "POST", body: { sid: SID, ymd: DATE, start: slot, phone: PHONE } })).status === 400);
  ok("slots rejects bad service", (await call(slots, { query: { sid: "nope", date: DATE } })).status === 400);

  // book
  r = await call(book, { method: "POST", body: { sid: SID, ymd: DATE, start: slot, name: "Test User", phone: PHONE, email: "t@e.com" } });
  ok("POST /book creates a booking", r.status === 200 && r.body.booking.ref.startsWith("PQC-"));
  const ref = r.body.booking.ref;
  ok("booking has server-authoritative fields", r.body.booking.durMin === 30 && r.body.booking.status === "booked");

  // slot now gone
  r = await call(slots, { query: { sid: SID, date: DATE } });
  ok("booked slot removed from availability", !r.body.slots.includes(slot));

  // double-book refused
  r = await call(book, { method: "POST", body: { sid: SID, ymd: DATE, start: slot, name: "Someone Else", phone: "8325550999" } });
  ok("double-book refused (409)", r.status === 409);

  // mine by phone (cross-device)
  r = await call(mine, { query: { phone: "8325550100" } });
  ok("GET /mine finds booking by phone digits", r.status === 200 && r.body.bookings.some((b) => b.ref === ref));

  // reschedule wrong phone
  r = await call(reschedule, { method: "POST", body: { ref, phone: "0000000", ymd: DATE, start: neighbour } });
  ok("reschedule with wrong phone refused (403)", r.status === 403);

  // reschedule right phone
  r = await call(reschedule, { method: "POST", body: { ref, phone: PHONE, ymd: DATE, start: neighbour } });
  ok("reschedule moves the appointment", r.status === 200 && r.body.booking.start === neighbour && r.body.booking.prevStart === slot);

  // old slot freed, new slot taken
  r = await call(slots, { query: { sid: SID, date: DATE } });
  ok("old slot freed after reschedule", r.body.slots.includes(slot));
  ok("new slot taken after reschedule", !r.body.slots.includes(neighbour));

  // calendar subscription feed (booking is active here)
  const calendar = await load("calendar");
  r = await call(calendar, { query: { token: "dev-calendar-token" } });
  ok("calendar feed returns iCalendar for a valid token", r.status === 200 && r.text.includes("BEGIN:VCALENDAR") && r.text.includes("BEGIN:VEVENT") && r.text.includes(ref));
  ok("calendar feed event carries the client + service", r.text.includes("Test User") && r.text.includes("Line Up"));
  ok("calendar feed rejects a bad token", (await call(calendar, { query: { token: "wrong" } })).status === 403);

  // admin auth
  ok("admin GET without PIN → 401", (await call(admin, { query: { range: "upcoming" } })).status === 401);
  ok("admin GET returns the calendar subscribe URL", (await call(admin, { query: { range: "upcoming" }, headers: { "x-admin-pin": "4242" } })).body.calendar.includes("/api/calendar?token="));
  r = await call(admin, { query: { range: "upcoming" }, headers: { "x-admin-pin": "4242" } });
  ok("admin GET with PIN lists bookings", r.status === 200 && r.body.bookings.some((b) => b.ref === ref));
  r = await call(admin, { method: "POST", body: { action: "confirm", ref }, headers: { "x-admin-pin": "4242" } });
  ok("admin can confirm a booking", r.status === 200 && r.body.booking.status === "confirmed");

  // cancel wrong then right
  ok("cancel wrong phone refused (403)", (await call(cancel, { method: "POST", body: { ref, phone: "1" } })).status === 403);
  r = await call(cancel, { method: "POST", body: { ref, phone: PHONE } });
  ok("cancel with right phone works", r.status === 200 && r.body.booking.status === "cancelled");
  r = await call(mine, { query: { phone: "8325550100" } });
  ok("cancelled booking drops out of /mine", !r.body.bookings.some((b) => b.ref === ref));

  console.log(`\nAPI: ${passed} checks passed.`);
};

run().catch((e) => { console.error("\n" + e.message); process.exit(1); });
