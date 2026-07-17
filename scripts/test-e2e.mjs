// End-to-end browser test of the wired page against the live dev API.
// Requires the dev server running on PORT (default 3100) with ADMIN_PIN=4242.
import { chromium } from "playwright-core";

const BASE = "http://localhost:" + (process.env.PORT || 3100);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PHONE = "(832) 555-0142";

let passed = 0;
const ok = (label, cond) => { if (!cond) throw new Error("FAIL: " + label); console.log("  ✓ " + label); passed++; };

async function openModal(page) {
  await page.waitForResponse((r) => r.url().includes("/api/services"), { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.PQCBook.open());
  await page.waitForSelector("#pqcb-root:not([hidden])");
}
// pick an open calendar day at least a few days out, navigating a month forward first
async function pickFutureDay(page) {
  await page.click('[data-mon="1"]'); // next month → avoids today/lead edges
  await page.waitForSelector(".pqcb-grid");
  await page.click(".pqcb-day:not(.off):not(.empty)");
}

const b = await chromium.launch({ executablePath: CHROME });

// ---------- device A: book online ----------
const ctxA = await b.newContext();
const A = await ctxA.newPage();
A.on("pageerror", (e) => { throw new Error("PAGEERROR(A): " + e.message); });
await A.goto(BASE + "/premiumqualitycuts.html");
await openModal(A);
ok("device A detects backend online", await A.evaluate(async () => {
  const r = await fetch("/api/services"); return r.ok;
}));

await A.click(".pqcb-srow"); // first service
await pickFutureDay(A);
await A.waitForResponse((r) => r.url().includes("/api/slots"));
await A.waitForSelector(".pqcb-slot");
const chosenDay = await A.evaluate(() => document.querySelector(".pqcb-chip [data-edit='date']") ? null : null); // noop
const slotText = await A.textContent(".pqcb-slot");
await A.click(".pqcb-slot");
await A.waitForSelector("#pqcb-form");
await A.fill("#pqcb-name", "Marcus Bell");
await A.fill("#pqcb-phone", PHONE);
await A.click("#pqcb-form button[type=submit]");
await A.waitForSelector("[data-confirm]");
const [bookResp] = await Promise.all([
  A.waitForResponse((r) => r.url().includes("/api/book")),
  A.click("[data-confirm]"),
]);
const bookJson = await bookResp.json();
ok("device A booking hit the server", bookJson.ok && bookJson.booking.ref.startsWith("PQC-"));
const ref = bookJson.booking.ref;
const ymd = bookJson.booking.ymd, start = bookJson.booking.start;
await A.waitForSelector(".pqcb-check");
ok("device A shows confirmation", (await A.textContent("#pqcb-title")).includes("booked"));

// ---------- device B: fresh browser, find by phone ----------
const ctxB = await b.newContext();
const B = await ctxB.newPage();
await B.goto(BASE + "/premiumqualitycuts.html");
await openModal(B);
// that slot must NOT be offered to device B (shared availability)
await B.click(".pqcb-srow");
await pickFutureDay(B);
// navigate to the SAME day A booked, then check the slot is gone
const gone = await B.evaluate(async ({ ymd, start }) => {
  const r = await fetch(`/api/slots?sid=s0_0&date=${ymd}`); const j = await r.json();
  return !j.slots.includes(start);
}, { ymd, start });
ok("device B cannot see the taken slot (shared availability)", gone);

// back out to My Appointments and find by phone
await B.click("#pqcb-back"); // time -> date
await B.click("#pqcb-back"); // date -> service
await B.waitForSelector("[data-mine]");
await B.click("[data-mine]");
await B.waitForSelector("#pqcb-findphone");
await B.fill("#pqcb-findphone", PHONE);
await Promise.all([
  B.waitForResponse((r) => r.url().includes("/api/mine")),
  B.click("[data-find]"),
]);
await B.waitForSelector("[data-resched]");
ok("device B retrieves the appointment by phone (cross-device)", (await B.textContent("#pqcb-body")).includes(ref));

// ---------- device B: reschedule ----------
await B.click(`[data-resched="${ref}"]`);
await B.waitForSelector(".pqcb-grid");
await B.click(".pqcb-day:not(.off):not(.empty)");
await B.waitForResponse((r) => r.url().includes("/api/slots"));
await B.waitForSelector(".pqcb-slot");
await B.click(".pqcb-slot");
await B.waitForSelector("[data-confirm]");
const [reResp] = await Promise.all([
  B.waitForResponse((r) => r.url().includes("/api/reschedule")),
  B.click("[data-confirm]"),
]);
const reJson = await reResp.json();
ok("device B reschedule hit the server and kept the ref", reJson.ok && reJson.booking.ref === ref && reJson.booking.prevStart === start);
await B.waitForSelector(".pqcb-check");
ok("device B shows 'Time updated'", (await B.textContent("#pqcb-title")).includes("updated"));

// ---------- admin sees it ----------
const ADM = await (await b.newContext()).newPage();
await ADM.goto(BASE + "/admin.html");
await ADM.fill("#pin", "4242");
await Promise.all([ ADM.waitForResponse((r) => r.url().includes("/api/admin")), ADM.click(".gate .btn") ]);
await ADM.click('.tab[data-range="upcoming"]');
await ADM.waitForResponse((r) => r.url().includes("/api/admin"));
await ADM.waitForSelector(".card");
ok("admin lists the appointment", (await ADM.textContent("#list")).includes(ref) && (await ADM.textContent("#list")).includes("Marcus Bell"));
// confirm it
await Promise.all([ ADM.waitForResponse((r) => r.url().includes("/api/admin")), ADM.click(".act.ok") ]);
await ADM.waitForResponse((r) => r.url().includes("/api/admin")).catch(() => {});
await ADM.waitForTimeout(300);
ok("admin can confirm (badge shows)", (await ADM.textContent("#list")).includes("confirmed"));

// admin wrong PIN rejected
const BAD = await (await b.newContext()).newPage();
await BAD.goto(BASE + "/admin.html");
await BAD.fill("#pin", "0000");
await BAD.click(".gate .btn");
await BAD.waitForSelector("#gate-err");
await BAD.waitForFunction(() => document.getElementById("gate-err").textContent.length > 0);
ok("admin rejects wrong PIN", (await BAD.textContent("#gate-err")).includes("Wrong PIN"));

console.log(`\nE2E: ${passed} checks passed.`);
await b.close();
