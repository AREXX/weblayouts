// GET /api/services — the catalogue + hours the page/admin can render from,
// and a cheap health check the front-end uses to detect it's online.
import { handler, sendJson } from "./_util.js";
import { SERVICES, SCHED, SHOP } from "./_shop.js";

export default handler("GET", async (req, res) => {
  sendJson(res, 200, { ok: true, services: SERVICES, schedule: SCHED, shop: SHOP });
});
