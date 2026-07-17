// Proves /api/book fires a Resend email when RESEND_API_KEY is set, by
// intercepting fetch. No real key or network needed.
import assert from "node:assert";

process.env.RESEND_API_KEY = "test-key";
process.env.SHOP_EMAIL = "shop@premiumqualitycuts.test";
process.env.MAIL_FROM = "PQC <booking@pqc.test>";

// capture outbound Resend calls
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.resend.com")) { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => "{}" }; }
  return realFetch(url, opts);
};

const book = (await import("../api/book.js")).default;

const dowOf = (ymd) => { const p = ymd.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); };
const SCHED = [null, null, [540, 1140], [540, 1140], [540, 1140], [450, 1140], [360, 900]];
function nextOpenDate() { const d = new Date(); d.setUTCDate(d.getUTCDate() + 5); for (let i = 0; i < 14; i++) { const y = d.toISOString().slice(0, 10); if (SCHED[dowOf(y)]) return y; d.setUTCDate(d.getUTCDate() + 1); } throw new Error("no open date"); }

function call(fn, body) {
  return new Promise((resolve, reject) => {
    const req = { method: "POST", query: {}, body, headers: {} };
    const res = { statusCode: 200, setHeader() {}, end(s) { resolve({ status: this.statusCode, body: JSON.parse(s) }); } };
    Promise.resolve(fn(req, res)).catch(reject);
  });
}

let passed = 0;
const ok = (l, c) => { assert.ok(c, "FAIL: " + l); console.log("  ✓ " + l); passed++; };

const DATE = nextOpenDate();
const START = SCHED[dowOf(DATE)][0]; // that day's opening time — always a valid slot
const r = await call(book, { sid: "s0_7", ymd: DATE, start: START, name: "Ivy Chen", phone: "8325550170", email: "ivy@example.com" });
ok("booking succeeded", r.status === 200 && r.body.ok);
ok("two Resend emails were sent (shop + customer)", calls.length === 2);
ok("emails came from configured sender", calls.every((c) => c.body.from === "PQC <booking@pqc.test>"));
ok("recipients are the shop and the customer", calls.some((c) => c.body.to[0] === "shop@premiumqualitycuts.test") && calls.some((c) => c.body.to[0] === "ivy@example.com"));
ok("payload has subject/text/html", calls.every((c) => c.body.subject && c.body.text && c.body.html));

console.log(`\nNOTIFY-SEND: ${passed} checks passed.`);
