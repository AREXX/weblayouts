// ---------------------------------------------------------------------------
// Small helpers shared by the API handlers. Written against the Node req/res
// interface so the same handlers run on Vercel Functions and the local dev
// server in scripts/dev-server.mjs.
// ---------------------------------------------------------------------------

// Read + JSON-parse the request body. Handles Vercel's pre-parsed object, a
// raw string, or a not-yet-read stream (local dev server).
export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

// Wrap a handler with method-allow-listing and a uniform error envelope.
export function handler(methods, fn) {
  const allow = Array.isArray(methods) ? methods : [methods];
  return async (req, res) => {
    if (!allow.includes(req.method)) {
      res.setHeader("Allow", allow.join(", "));
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    }
    try {
      await fn(req, res);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[api] error:", e && e.stack ? e.stack : e);
      if (!res.writableEnded) sendJson(res, 500, { ok: false, error: "Server error" });
    }
  };
}

// query object regardless of runtime (Vercel provides req.query; dev server sets it)
export function query(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, "http://localhost");
  return Object.fromEntries(u.searchParams.entries());
}

export function normPhone(s) { return String(s || "").replace(/\D/g, ""); }
export function validPhone(s) { return normPhone(s).length >= 7; }
export function validEmail(s) { return s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "")); }

// PQC-XXXXXX booking reference
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusables
export function makeRef() {
  let r = "";
  for (let i = 0; i < 6; i++) r += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return "PQC-" + r;
}

// Barber admin auth — PIN in the x-admin-pin header vs ADMIN_PIN env.
export function adminOk(req) {
  const expected = process.env.ADMIN_PIN || "1234"; // dev default; set ADMIN_PIN in production
  const got = req.headers["x-admin-pin"] || (query(req).pin || "");
  return String(got) === String(expected) && String(expected).length > 0;
}
