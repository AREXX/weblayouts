// POST /api/cancel  { ref, phone }
// Marks an appointment cancelled (kept as a row so the barber has a record).
// Requires the booking's phone to match.
import { handler, sendJson, readBody, normPhone } from "./_util.js";
import { db, rowToBooking } from "./_db.js";

export default handler("POST", async (req, res) => {
  const b = await readBody(req);
  const ref = String(b.ref || "").trim();
  if (!ref) return sendJson(res, 400, { ok: false, error: "Missing reference." });

  const client = await db();
  const { rows: found } = await client.query(`SELECT * FROM bookings WHERE ref = $1`, [ref]);
  const cur = found[0];
  if (!cur) return sendJson(res, 404, { ok: false, error: "Appointment not found." });
  if (normPhone(cur.phone) !== normPhone(b.phone)) return sendJson(res, 403, { ok: false, error: "Phone number doesn't match this booking." });

  const { rows } = await client.query(
    `UPDATE bookings SET status = 'cancelled', updated = $2 WHERE ref = $1 RETURNING *`,
    [ref, Date.now()]
  );
  sendJson(res, 200, { ok: true, booking: rowToBooking(rows[0]) });
});
