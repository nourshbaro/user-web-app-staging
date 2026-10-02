import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import {
  blueSuccessResultParams,
  clearBluePaymentHandoff,
  clearPendingBluePaymentAttempt,
  createBluePaymentHandoff,
  invalidatePendingBluePaymentAttemptUnlessSession,
  readBluePaymentHandoff,
  readPendingBluePaymentAttempt,
  savePendingBluePaymentAttempt,
} from "./bluePaymentHandoff.ts";
import { checkoutResultRouteParams, parseCheckoutResultParams, singlePurchasedMatchId } from "./checkoutResultParams.ts";
import { purchasedTicketsAction } from "./checkoutResultPresentation.ts";
import {
  acquirePaymentAttempt,
  clearPaymentOutcomeLockUnlessSession,
  configurePaymentOutcomeStore,
  parkPaymentAttempt,
} from "./paymentOutcomeLock.ts";

const BLUE_URL = "https://blue.example/payment/order-a";
const store = () => {
  let value = null;
  return { get: async () => value, set: async (next) => { value = next; }, remove: async () => { value = null; } };
};

/** Checkout's first "Continue with BLUE" (submitBlue): the backend created the order; save it, then launch. */
function sendBlue(sessionId, ticketsByMatch) {
  const purchasedMatchId = singlePurchasedMatchId(ticketsByMatch);
  savePendingBluePaymentAttempt({ sessionId, paymentUrl: BLUE_URL, orderId: "1034", purchasedMatchId });
  return createBluePaymentHandoff(BLUE_URL, sessionId, purchasedMatchId);
}

/** Checkout's reuse path: reopen the stored BLUE order (no submit), as launchBluePayment receives it. */
function resumeBlue(sessionId) {
  const reusable = readPendingBluePaymentAttempt(sessionId);
  if (!reusable) return null;
  return createBluePaymentHandoff(reusable.paymentUrl, reusable.sessionId, reusable.purchasedMatchId ?? null);
}

/** BluePaymentScreen's trusted success → /checkout/success → "View my ticket". */
function successDestination(handoffId) {
  const handoff = readBluePaymentHandoff(handoffId);
  const params = blueSuccessResultParams(handoff, { order_number: "ORD-1034" });
  const result = parseCheckoutResultParams(checkoutResultRouteParams(parseCheckoutResultParams(params)));
  return purchasedTicketsAction(result).href;
}

beforeEach(() => {
  clearPendingBluePaymentAttempt();
  clearPaymentOutcomeLockUnlessSession(null);
  configurePaymentOutcomeStore(store());
});

test("Codex repro: BLUE for match 17 → park → resume keeps match 17 and opens its tickets, not /tickets", async () => {
  const first = sendBlue("S", { 17: [{ holder_name: "A" }] });
  assert.equal(readBluePaymentHandoff(first).purchasedMatchId, "17");
  const blue = await acquirePaymentAttempt("S", "blue");

  // BLUE → Back (park) → Other → Back: the BLUE page is gone, its record stays.
  clearBluePaymentHandoff(first);
  parkPaymentAttempt("S");

  // → BLUE: the same parked attempt, the same order and URL, the same match.
  const resumedAttempt = await acquirePaymentAttempt("S", "blue");
  assert.equal(resumedAttempt.attempt.id, blue.attempt.id);
  const resumed = resumeBlue("S");
  const handoff = readBluePaymentHandoff(resumed);
  assert.equal(handoff.paymentUrl, BLUE_URL);
  assert.equal(readPendingBluePaymentAttempt("S").orderId, "1034");
  assert.equal(handoff.purchasedMatchId, "17", "resumed match id remains 17");

  assert.deepEqual(successDestination(resumed), { pathname: "/tickets", params: { match: "17", order: "ORD-1034" } });
});

test("multi-match BLUE orders keep no match and fall back to My Tickets, initially and after resuming", () => {
  const first = sendBlue("S", { 17: [{ holder_name: "A" }], 9: [{ holder_name: "B" }] });
  assert.equal(readBluePaymentHandoff(first).purchasedMatchId, null);
  assert.equal(successDestination(first), "/tickets");
  const resumed = resumeBlue("S");
  assert.equal(readBluePaymentHandoff(resumed).purchasedMatchId, null);
  assert.equal(successDestination(resumed), "/tickets");
});

test("another session can never borrow a BLUE attempt's match", () => {
  sendBlue("S1", { 17: [{ holder_name: "A" }] });
  assert.equal(resumeBlue("S2"), null, "no pending BLUE for a different session");
  // A new session replaces the old one: the old record (and its match) is dropped.
  invalidatePendingBluePaymentAttemptUnlessSession("S2");
  assert.equal(readPendingBluePaymentAttempt("S1"), null);
  assert.equal(resumeBlue("S1"), null);
  // A new BLUE order for S2 carries only its own submitted match.
  const next = sendBlue("S2", { 9: [{ holder_name: "B" }] });
  assert.equal(readBluePaymentHandoff(next).purchasedMatchId, "9");
});

test("the stored match is never fabricated: anything but a submitted backend id is dropped", () => {
  for (const purchasedMatchId of ["", "abc", "17; drop", "../17", undefined]) {
    savePendingBluePaymentAttempt({ sessionId: "S", paymentUrl: BLUE_URL, purchasedMatchId });
    assert.equal(readPendingBluePaymentAttempt("S").purchasedMatchId, null, String(purchasedMatchId));
  }
  assert.deepEqual(blueSuccessResultParams({ purchasedMatchId: "x" }, {}), { provider: "blue" });
});

test("resuming reuses the stored order: the reuse branch never submits or saves a new BLUE record", async () => {
  const checkout = (await readFile(new URL("../app/checkout.tsx", import.meta.url), "utf8")).replace(/^\s*\/\/.*$/gm, "");
  const reuse = checkout.slice(checkout.indexOf("const reusableAttempt = readPendingBluePaymentAttempt("), checkout.indexOf("const checkoutBilling = createCheckoutBilling("));
  assert.match(reuse, /launchBluePayment\(\s*reusableAttempt\.paymentUrl,\s*reusableAttempt\.sessionId,\s*reusableAttempt\.purchasedMatchId \?\? null,\s*\)/);
  assert.doesNotMatch(reuse, /checkoutService\.submit|savePendingBluePaymentAttempt/);
  // And the success screen builds its params through the same helper tested above.
  const screen = await readFile(new URL("../components/BluePaymentScreen.native.tsx", import.meta.url), "utf8");
  assert.match(screen, /params: blueSuccessResultParams\(handoff, displayParams\),/);
});
