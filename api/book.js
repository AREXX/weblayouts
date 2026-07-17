// POST /api/book  { sid, ymd, start, name, phone, email?, notes? }
// Creates a booking. The insert refuses to write if the slot overlaps an
// existing (non-cancelled) appointment, so concurrent devices can't double-book.
import { handler, sendJson, readBody, makeRef, validPhone, validEmail } from "./_util.js";
import { svc, computeSlots, isValidYmd, STEP_BUFFER } from "./_shop.js";
import { db, rowToBooking } from "./_db.js";
import { notify } from "./_notify.js";

export default handler("POST", async (req, res) => {
  const b = await readBody(req);
  const s = svc(b.sid);
  if (!s) return sendJson(res, 400, { ok: false, error: "Please choose a service." });
  if (!isValidYmd(b.ymd)) return sendJson(res, 400, { ok: false, error: "Please pick a valid date." });
  const start = Number(b.start);
  if (!Number.isInteger(start) || start < 0) return sendJson(res, 400, { ok: false, error: "Please pick a time." });
  const name = String(b.name || "").trim();
  const phone = String(b.phone || "").trim();
  const email = String(b.email || "").trim();
  const notes = String(b.notes || "").trim();
  if (name.length < 2) return sendJson(res, 400, { ok: false, error: "Please tell us your name." });
  if (!validPhone(phone)) return sendJson(res, 400, { ok: false, error: "A valid mobile number is needed." });
  if (!validEmail(email)) return sendJson(res, 400, { ok: false, error: "That email doesn't look right." });

  const client = await db();

  // schedule / lead-time / granularity check (does not race)
  const { rows: busyRows } = await client.query(
    `SELECT start_min, dur_min FROM bookings WHERE ymd = $1 AND status <> 'cancelled'`,
    [b.ymd]
  );
  const busy = busyRows.map((r) => ({ start: r.start_min, durMin: r.dur_min }));
  if (computeSlots(b.ymd, s.durMin, busy).indexOf(start) < 0) {
    return sendJson(res, 409, { ok: false, error: "That time isn't available — please pick another." });
  }

  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = makeRef();
    try {
      const { rows } = await client.query(
        `INSERT INTO bookings
           (ref, sid, sname, grp, price, dep_num, ymd, start_min, dur_min, name, phone, email, notes, status, created, updated)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'booked',$14,$14
         WHERE NOT EXISTS (
           SELECT 1 FROM bookings x
           WHERE x.ymd = $7 AND x.status <> 'cancelled'
             AND $8 < x.start_min + x.dur_min + $15
             AND $8 + $9 + $15 > x.start_min
         )
         RETURNING *`,
        [ref, s.id, s.name, s.group, s.price, s.depNum, b.ymd, start, s.durMin, name, phone, email, notes, now, STEP_BUFFER]
      );
      if (!rows.length) {
        // lost the race — slot taken between the check and the insert
        return sendJson(res, 409, { ok: false, error: "That time was just taken — please pick another." });
      }
      const booking = rowToBooking(rows[0]);
      await notify("booked", booking); // best-effort; never throws
      return sendJson(res, 200, { ok: true, booking });
    } catch (e) {
      if (String(e && e.code) === "23505") continue; // ref collision → new ref
      throw e;
    }
  }
  return sendJson(res, 500, { ok: false, error: "Couldn't generate a booking reference — please retry." });
});
