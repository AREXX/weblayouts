// GET /api/slots?date=YYYY-MM-DD&sid=SERVICE_ID
// Server-authoritative list of open start-times for a service on a day, using
// the live set of bookings so two devices can't be shown the same free slot.
import { handler, sendJson, query } from "./_util.js";
import { svc, computeSlots, isValidYmd } from "./_shop.js";
import { db } from "./_db.js";

export default handler("GET", async (req, res) => {
  const q = query(req);
  const s = svc(q.sid);
  if (!s) return sendJson(res, 400, { ok: false, error: "Unknown service" });
  if (!isValidYmd(q.date)) return sendJson(res, 400, { ok: false, error: "Bad date" });

  const client = await db();
  const { rows } = await client.query(
    `SELECT start_min, dur_min FROM bookings WHERE ymd = $1 AND status <> 'cancelled'`,
    [q.date]
  );
  const busy = rows.map((r) => ({ start: r.start_min, durMin: r.dur_min }));
  const slots = computeSlots(q.date, s.durMin, busy);
  sendJson(res, 200, { ok: true, date: q.date, sid: s.id, durMin: s.durMin, slots });
});
