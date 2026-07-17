// GET /api/services — the catalogue + hours the page/admin render from, and the
// health check the front-end uses to decide it's online. It touches the database
// so "online" means the backend is actually ready (DB connected), not just that
// the function booted — otherwise the page would think it's online with no store.
import { handler, sendJson } from "./_util.js";
import { SERVICES, SCHED, SHOP } from "./_shop.js";
import { db } from "./_db.js";

export default handler("GET", async (req, res) => {
  const client = await db();
  await client.query("SELECT 1");
  sendJson(res, 200, { ok: true, services: SERVICES, schedule: SCHED, shop: SHOP });
});
