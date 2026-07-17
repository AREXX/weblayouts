// GET /api/mine?phone=PHONE
// A customer's upcoming appointments, keyed by phone — this is what makes
// tracking work across devices (book on one phone, see it on another).
import { handler, sendJson, query, normPhone, validPhone } from "./_util.js";
import { shopNow } from "./_shop.js";
import { db, rowToBooking } from "./_db.js";

export default handler("GET", async (req, res) => {
  const phone = query(req).phone || "";
  if (!validPhone(phone)) return sendJson(res, 400, { ok: false, error: "A valid phone is needed." });

  const client = await db();
  const today = shopNow().ymd;
  // match on normalised digits so formatting differences don't matter
  const { rows } = await client.query(
    `SELECT * FROM bookings
     WHERE regexp_replace(phone, '\\D', '', 'g') = $1
       AND status <> 'cancelled' AND ymd >= $2
     ORDER BY ymd ASC, start_min ASC`,
    [normPhone(phone), today]
  );
  sendJson(res, 200, { ok: true, bookings: rows.map(rowToBooking) });
});
