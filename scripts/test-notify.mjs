// Unit-tests the email composition + recipient rules (pure, no network/key).
import assert from "node:assert";

process.env.SHOP_EMAIL = "shop@premiumqualitycuts.test";
delete process.env.RESEND_API_KEY; // ensure notify() no-ops without a key

const { buildEmails, notify, notifyEnabled } = await import("../api/_notify.js");

let passed = 0;
const ok = (label, cond) => { assert.ok(cond, "FAIL: " + label); console.log("  ✓ " + label); passed++; };

const booking = {
  ref: "PQC-ABC123", sid: "s0_3", sname: "Rese-Static w/ Beard", group: "The Cuts",
  price: "$60", depNum: 5, ymd: "2026-08-15", start: 840, durMin: 40,
  name: "Marcus Bell", phone: "(832) 555-0142", email: "marcus@example.com",
  notes: "Running 5 min late maybe", status: "booked", prevYmd: null, prevStart: null,
};

// booked → shop + customer
let msgs = buildEmails("booked", booking);
ok("booked emails both shop and customer", msgs.length === 2);
const shop = msgs.find((m) => m.to === "shop@premiumqualitycuts.test");
const cust = msgs.find((m) => m.to === "marcus@example.com");
ok("shop email present", !!shop && /New booking/.test(shop.subject));
ok("customer email present", !!cust && /booked/i.test(cust.subject));
ok("email body carries service, time, ref, phone", shop.text.includes("Rese-Static w/ Beard") && shop.text.includes("2 PM") && shop.text.includes("PQC-ABC123") && shop.text.includes("(832) 555-0142"));
ok("html body is present", shop.html.includes("PQC-ABC123") && shop.html.includes("<table"));

// toShop:false → customer only
ok("toShop:false suppresses shop email", buildEmails("confirmed", booking, { toShop: false }).every((m) => m.to === "marcus@example.com"));

// no customer email address → shop only
ok("no customer email → shop only", buildEmails("booked", { ...booking, email: "" }).length === 1);

// reschedule includes the previous slot
const moved = { ...booking, prevYmd: "2026-08-12", prevStart: 600 };
msgs = buildEmails("reschedule", moved);
ok("reschedule email shows previous time", msgs[0].text.includes("Previously") && msgs[0].text.includes("10 AM"));

// cancel + confirmed heads
ok("cancel subject reads cancelled", /cancel/i.test(buildEmails("cancel", booking)[0].subject));
ok("confirmed subject reads confirmed", buildEmails("confirmed", booking).some((m) => /confirm/i.test(m.subject)));

// notify() is a safe no-op without a key
ok("notifyEnabled() false without key", notifyEnabled() === false);
ok("notify() returns 0 (no-op) without key", (await notify("booked", booking)) === 0);

console.log(`\nNOTIFY: ${passed} checks passed.`);
