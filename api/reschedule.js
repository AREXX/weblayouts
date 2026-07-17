// POST /api/reschedule  { ref, phone, ymd, start }
// Moves an existing appointment to a new slot. Requires the booking's phone
// (so a guessed ref alone can't move someone else's appointment). The update
// refuses to write if the new slot overlaps another appointment.
import { handler, sendJson, readBody, normPhone } from "./_util.js";
import { svc, computeSlots, isValidYmd, STEP_BUFFER } from "./_shop.js";
import { db, rowToBooking } from "./_db.js";

export default handler("POST", async (req, res) => {
  const b = await readBody(req);
  const ref = String(b.ref || "").trim();
  if (!ref) return sendJson(res, 400, { ok: false, error: "Missing reference." });
  if (!isValidYmd(b.ymd)) return sendJson(res, 400, { ok: false, error: "Please pick a valid date." });
  const start = Number(b.start);
  if (!Number.isInteger(start) || start < 0) return sendJson(res, 400, { ok: false, error: "Please pick a time." });

  const client = await db();
  const { rows: found } = await client.query(`SELECT * FROM bookings WHERE ref = $1`, [ref]);
  const cur = found[0];
  if (!cur || cur.status === "cancelled") return sendJson(res, 404, { ok: false, error: "Appointment not found." });
  if (normPhone(cur.phone) !== normPhone(b.phone)) return sendJson(res, 403, { ok: false, error: "Phone number doesn't match this booking." });

  const s = svc(cur.sid) || { durMin: cur.dur_min };
  const durMin = s.durMin;

  // schedule / lead-time check, ignoring this appointment's own current slot
  const { rows: busyRows } = await client.query(
    `SELECT start_min, dur_min FROM bookings WHERE ymd = $1 AND status <> 'cancelled' AND ref <> $2`,
    [b.ymd, ref]
  );
  const busy = busyRows.map((r) => ({ start: r.start_min, durMin: r.dur_min }));
  if (computeSlots(b.ymd, durMin, busy).indexOf(start) < 0) {
    return sendJson(res, 409, { ok: false, error: "That time isn't available — please pick another." });
  }

  const { rows } = await client.query(
    `UPDATE bookings SET
       prev_ymd = ymd, prev_start = start_min,
       ymd = $2, start_min = $3, dur_min = $4, status = 'booked', updated = $5
     WHERE ref = $1
       AND NOT EXISTS (
         SELECT 1 FROM bookings x
         WHERE x.ref <> $1 AND x.ymd = $2 AND x.status <> 'cancelled'
           AND $3 < x.start_min + x.dur_min + $6
           AND $3 + $4 + $6 > x.start_min
       )
     RETURNING *`,
    [ref, b.ymd, start, durMin, Date.now(), STEP_BUFFER]
  );
  if (!rows.length) return sendJson(res, 409, { ok: false, error: "That time was just taken — please pick another." });
  sendJson(res, 200, { ok: true, booking: rowToBooking(rows[0]) });
});
