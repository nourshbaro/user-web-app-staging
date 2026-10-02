import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkoutAttemptBlocks, paymentSubmitBlocker } from "./checkoutFlow.ts";
import { expiredHoldFrom, holdExpiredMessageKey, holdRestartRoute } from "./holdExpiry.ts";
import { EASE_OUT_V3, statBarMotion, statBarOrigin, timelineRowMotion } from "./matchMotion.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* hold_expired ------------------------------------------------------------- */

test("an expired hold keeps only its unique match ids and whether a payment touched it", () => {
  const items = [
    { match_id: "4", lock_key: "L1", seat_ids: [1, 2], price: "6.00" },
    { match_id: "4", lock_key: "L2" },
    { match_id: 9, lock_key: "L3" },
    { match_id: "../x" },
    { match_id: null },
  ];
  const hold = expiredHoldFrom(items, false);
  assert.deepEqual(hold, { matchIds: ["4", "9"], paymentTouched: false });
  // Nothing else survives: no lock keys, seats, prices, sessions or payment data.
  assert.deepEqual(Object.keys(hold).sort(), ["matchIds", "paymentTouched"]);
});

test("Start again: one match → its Match Details; several (or none known) → Matches on Upcoming", () => {
  assert.deepEqual(holdRestartRoute({ matchIds: ["4"], paymentTouched: false }), { pathname: "/match/[id]", params: { id: "4" } });
  assert.equal(holdRestartRoute({ matchIds: ["4", "9"], paymentTouched: false }), "/matches");
  assert.equal(holdRestartRoute({ matchIds: [], paymentTouched: false }), "/matches");
});

test("'No payment was taken' only when no payment touched the expired session", () => {
  assert.equal(holdExpiredMessageKey({ matchIds: ["4"], paymentTouched: false }), "holdExpired.message");
  assert.equal(holdExpiredMessageKey({ matchIds: ["4"], paymentTouched: true }), "holdExpired.messagePayment");
});

test("expiry captures the snapshot before the destructive clear, from the owner only", async () => {
  const cart = strip(await read("../context/CartContext.tsx"));
  const expire = cart.slice(cart.indexOf("const expireCart = useCallback"), cart.indexOf("const dismissExpiredHold"));
  const snapshot = expire.indexOf("const snapshot = expiredHoldFrom(");
  const clear = expire.indexOf("await clearCartSessionIfCurrent(");
  assert.ok(snapshot > 0 && clear > snapshot, "captured before the clear");
  assert.match(expire, /readPaymentOutcomeLock\(expected\.sessionId\)[\s\S]*readPaymentAttempt\(expected\.sessionId\)[\s\S]*readPendingBluePaymentAttempt\(/);
  // Published only by a successful same-session clear, in the same update, then navigation resets.
  assert.match(expire, /resetDisplayState: \(\) => \{\s*resetCartDisplayState\(\);\s*setExpiredHold\(snapshot\);\s*\},/);
  assert.match(expire, /if \(!cleared\) return;\s*dismissEverythingAndGoHome\(\);/);
  // Expiry is the only writer; any later reset (logout, another session) retires it.
  assert.equal(cart.match(/setExpiredHold\(snapshot\)/g)?.length, 1);
  assert.match(cart, /setExpiredHold\(null\);\s*setSessionId\(null\);/);
});

test("the v3 sheet's actions: Start again routes by the snapshot, Back to home (and Android back) just closes", async () => {
  const sheet = strip(await read("../components/cart/HoldExpiredSheet.tsx"));
  // Both actions reset to a clean Home stack first (a screen's own guard may have navigated after expiry).
  assert.match(sheet, /const route = holdRestartRoute\(hold\);\s*cart\.dismissExpiredHold\(\);\s*resetToHome\(\);/);
  assert.match(sheet, /const backToHome = \(\) => \{\s*cart\.dismissExpiredHold\(\);\s*resetToHome\(\);\s*\};/);
  assert.match(sheet, /if \(router\.canDismiss\(\)\) router\.dismissAll\(\);\s*router\.replace\("\/"\);/);
  assert.match(sheet, /onRequestClose=\{backToHome\}/);
  // Transaction screens' empty-cart redirects stand down while the sheet is presented.
  const checkout = strip(await read("../app/checkout.tsx"));
  const holders = strip(await read("../app/checkout/ticket-holders.tsx"));
  assert.match(checkout, /!cart\.items\.length && !cart\.expiredHold\)\s*router\.replace\("\/cart"\)/);
  assert.match(holders, /if \(!ticketSlots\.length && !cart\.expiredHold\) router\.replace\("\/cart"\)/);
  assert.doesNotMatch(sheet, /addItem|refreshCart|clearCart|acquirePaymentAttempt/);
});

test("state panel text spans the panel, so Android cannot drop a title's last word", async () => {
  const panel = strip(await read("../components/foundation/StatePanel.tsx"));
  assert.match(panel, /title: \{ fontSize: 17, lineHeight: 22, alignSelf: "stretch" as const \}/);
  assert.match(panel, /message: \{ fontSize: 14, lineHeight: 20, alignSelf: "stretch" as const \}/);
});

/* Payment-method switching (behaviour: src/lib/paymentSwitching.test.mjs) ------- */

test("an in-progress attempt and an unknown outcome still block every method", () => {
  for (const paymentMethod of ["blue", "cybersource"]) {
    assert.equal(checkoutAttemptBlocks({ heldMethod: "card", paymentMethod, hasReusableBlueAttempt: true }), true, paymentMethod);
  }
  const owner = { sessionId: "S", itemCount: 1, expired: false, reconciliationRequired: false, paymentOutcomeUnknown: true, paymentAttemptInProgress: false };
  assert.equal(paymentSubmitBlocker({ sessionId: "S", owner }), "locked");
  assert.equal(paymentSubmitBlocker({ sessionId: "S", owner: { ...owner, paymentOutcomeUnknown: false, paymentAttemptInProgress: true } }), "inProgress");
});

/* Completed-match motion ---------------------------------------------------------- */

test("Stats bars follow v3 lfBar: 0.7s, 120ms + 50ms per row, ease-out, from the centre line", () => {
  assert.deepEqual(statBarMotion(0, false), { duration: 700, delay: 120, easing: EASE_OUT_V3 });
  assert.deepEqual(statBarMotion(4, false), { duration: 700, delay: 320, easing: EASE_OUT_V3 });
  assert.deepEqual(EASE_OUT_V3, [0.22, 1, 0.36, 1]);
  assert.equal(statBarOrigin("home", false), "right");
  assert.equal(statBarOrigin("away", false), "left");
  assert.equal(statBarOrigin("home", true), "left", "RTL mirrors the centre line");
  assert.equal(statBarOrigin("away", true), "right");
});

test("reduced motion: Stats and Timeline render their final state with no movement", () => {
  assert.equal(statBarMotion(0, true), null);
  assert.equal(timelineRowMotion(3, true), null);
  assert.deepEqual(timelineRowMotion(3, false), { duration: 360, delay: 165 });
});

test("Stats rows do not rise in; only the real-width bars grow, and values are final from the first frame", async () => {
  const view = strip(await read("../components/match/MatchInfoView.tsx"));
  assert.match(view, /<StatItem key=\{stat\.key\} stat=\{stat\} index=\{index\} \/>/);
  assert.doesNotMatch(view, /<Reanimated\.View key=\{stat\.key\}/);
  assert.match(view, /width: `\$\{share\}%`[\s\S]*?transform: \[\{ scaleX: grow \}\]/);
  // Missing statistics keep "—" and draw no bar.
  assert.match(view, /side === null \? "—"/);
  assert.match(view, /const bars = stat\.homeShare !== null && stat\.awayShare !== null;/);
});
