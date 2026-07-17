// /api/admin — the barber's view. PIN-protected via the x-admin-pin header
// (set ADMIN_PIN in the environment; defaults to 1234 for local dev).
//   GET  /api/admin?range=upcoming|today|all   -> list bookings
//   POST /api/admin  { action:'confirm'|'cancel'|'noshow'|'book', ref }
import { handler, sendJson, readBody, query, adminOk } from "./_util.js";
import { shopNow } from "./_shop.js";
import { db, rowToBooking } from "./_db.js";
import { notify } from "./_notify.js";

const ACTION_STATUS = { confirm: "confirmed", cancel: "cancelled", noshow: "noshow", book: "booked" };

export default handler(["GET", "POST"], async (req, res) => {
  if (!adminOk(req)) return sendJson(res, 401, { ok: false, error: "Unauthorized" });
  const client = await db();

  if (req.method === "GET") {
    const range = query(req).range || "upcoming";
    const today = shopNow().ymd;
    let where = "", params = [];
    if (range === "today") { where = "WHERE ymd = $1"; params = [today]; }
    else if (range === "upcoming") { where = "WHERE ymd >= $1"; params = [today]; }
    // range === 'all' → no filter
    const { rows } = await client.query(
      `SELECT * FROM bookings ${where} ORDER BY ymd ASC, start_min ASC`, params
    );
    return sendJson(res, 200, { ok: true, today, bookings: rows.map(rowToBooking) });
  }

  // POST — status action
  const b = await readBody(req);
  const ref = String(b.ref || "").trim();
  const status = ACTION_STATUS[b.action];
  if (!ref || !status) return sendJson(res, 400, { ok: false, error: "Bad action or reference." });
  const { rows } = await client.query(
    `UPDATE bookings SET status = $2, updated = $3 WHERE ref = $1 RETURNING *`,
    [ref, status, Date.now()]
  );
  if (!rows.length) return sendJson(res, 404, { ok: false, error: "Appointment not found." });
  const booking = rowToBooking(rows[0]);
  // let the customer know when the barber confirms or cancels (no shop self-email)
  if (b.action === "confirm") await notify("confirmed", booking, { toShop: false });
  else if (b.action === "cancel") await notify("cancel", booking, { toShop: false });
  sendJson(res, 200, { ok: true, booking });
});
