/**
 * Free tickets.
 *
 * Case 1: the backend cart total is exactly 0. Checkout shows no method and
 * submits `/checkout/mobile/submit` with `payment_method: "free"`, under the
 * same session payment gate as BLUE and card. Only a response that proves the
 * order (order id + status "paid", no payment_url) for the same cart session
 * clears the cart and opens the success screen.
 *
 * Case 2: a mixed cart (total > 0) pays normally; free lines show "Free".
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cardSubmitCompletion, freeSubmitCompletion } from "./cardPaymentResult.ts";
import { checkoutAttemptBlocks, checkoutReadiness } from "./checkoutFlow.ts";
import { checkoutResultRouteParams, parseCheckoutResultParams } from "./checkoutResultParams.ts";
import { getCheckoutResultPresentation, getCheckoutResultProviderKey } from "./checkoutResultPresentation.ts";
import { isFreeCartTotal, parseCartTotal } from "./cartTotal.ts";
import { formatLinePrice, formatMoney } from "./format.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const section = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing: ${end}`);
  return source.slice(from, to);
};

let processCount = 0;
async function lockProcess() {
  const lock = await import(`./paymentOutcomeLock.ts?free=${(processCount += 1)}`);
  let value = null;
  const disk = { get: async () => value, set: async (next) => { value = next; }, remove: async () => { value = null; } };
  lock.configurePaymentOutcomeStore(disk);
  return { lock, disk };
}

// ── Completion rule ────────────────────────────────────────────────────────

test("a free order is complete only with an order id and status paid, and no payment_url", () => {
  assert.equal(freeSubmitCompletion({ order_id: 12, status: "paid" }), "complete");
  assert.equal(freeSubmitCompletion({ order_number: "LFA-12", status: "PAID" }), "complete");
  assert.equal(freeSubmitCompletion({ order_id: 12 }), "unresolved", "no status");
  assert.equal(freeSubmitCompletion({ status: "paid" }), "unresolved", "no order");
  assert.equal(freeSubmitCompletion({ order_id: 12, status: "pending_payment" }), "unresolved");
  assert.equal(freeSubmitCompletion({ order_id: 12, status: "paid", payment: { payment_url: "https://x" } }), "unresolved");
  assert.equal(freeSubmitCompletion({ order_id: 12, status: "paid", success: false }), "unresolved");
  assert.equal(freeSubmitCompletion(null), "unresolved");
  for (const body of [{ order_id: 1, status: "paid" }, { order_id: 1 }, null]) {
    assert.equal(freeSubmitCompletion(body), cardSubmitCompletion(body), "same rule as a completed card order");
  }
});

// ── Session payment gate ───────────────────────────────────────────────────

test("a free attempt holds the session like any payment: it blocks card and BLUE, and is blocked by them", async () => {
  const { lock } = await lockProcess();
  const free = await lock.acquirePaymentAttempt("S1", "free");
  assert.equal(free.ok, true);
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "card"), { ok: false, reason: "blocked" });
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "blue"), { ok: false, reason: "blocked" });
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "free"), { ok: false, reason: "blocked" }, "never sent twice");
  assert.equal(checkoutAttemptBlocks({ heldMethod: "free", paymentMethod: "free", hasReusableBlueAttempt: false }), true);
  assert.equal(checkoutAttemptBlocks({ heldMethod: "free", paymentMethod: "blue", hasReusableBlueAttempt: true }), true);
  await lock.settlePaymentAttempt("S1", free.attempt.id);
  const blue = await lock.acquirePaymentAttempt("S1", "blue");
  assert.equal(blue.ok, true, "a definite rejection releases the session");
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "free"), { ok: false, reason: "blocked" });
});

test("an unknown free outcome locks the session for every method, and survives a restart", async () => {
  const { lock, disk } = await lockProcess();
  const free = await lock.acquirePaymentAttempt("S1", "free");
  assert.equal(free.ok, true);
  lock.markPaymentOutcomeUnknown("S1", "free");
  assert.deepEqual(lock.readPaymentOutcomeLock("S1", null, "free"), { sessionId: "S1", method: "free" });
  for (const method of ["free", "blue", "card"]) {
    assert.deepEqual(await lock.acquirePaymentAttempt("S1", method), { ok: false, reason: "blocked" });
  }
  // The persisted record restores as a "free" lock, not an unreadable one.
  assert.deepEqual(lock.parsePaymentOutcomeRecord(await disk.get()), { sessionId: "S1", method: "free" });
  const next = await import(`./paymentOutcomeLock.ts?free=${(processCount += 1)}`);
  next.configurePaymentOutcomeStore(disk);
  await next.restorePaymentOutcomeLock("S1");
  assert.deepEqual(next.readPaymentOutcomeLock("S1", null, "free"), { sessionId: "S1", method: "free" });
});

test("an account-scope card pause never blocks a free order (no card involved)", async () => {
  const { lock } = await lockProcess();
  // No marker store: card is paused for the account; BLUE and free are not.
  await lock.selectPaymentAccount("7");
  assert.equal(lock.readPaymentOutcomeLock("S2")?.scope, "account");
  assert.equal(lock.readPaymentOutcomeLock("S2", null, "free"), null);
  assert.deepEqual(await lock.acquirePaymentAttempt("S2", "card"), { ok: false, reason: "blocked" });
  assert.equal((await lock.acquirePaymentAttempt("S2", "free")).ok, true);
});

// ── Readiness ──────────────────────────────────────────────────────────────

test("a free cart needs no chosen method but keeps every other prerequisite", () => {
  const base = { itemCount: 1, secondsLeft: 60, locked: false, holdersComplete: true, profileComplete: true, phoneValid: true };
  assert.deepEqual(checkoutReadiness({ ...base, paymentMethod: "free" }), { ready: true, blocker: null });
  assert.equal(checkoutReadiness({ ...base, paymentMethod: "free", secondsLeft: 0 }).blocker, "expired");
  assert.equal(checkoutReadiness({ ...base, paymentMethod: "free", holdersComplete: false }).blocker, "holders");
  assert.equal(checkoutReadiness({ ...base, paymentMethod: "free", phoneValid: false }).blocker, "phone");
  assert.equal(checkoutReadiness({ ...base, paymentMethod: "free", paymentOutcomeUnknown: true }).blocker, "paymentUnknown");
});

// ── Checkout source ────────────────────────────────────────────────────────

test("Checkout decides 'free' from the backend total, hides the methods, and never sends 'free' otherwise", async () => {
  const checkout = strip(await read("../app/checkout.tsx"));
  assert.match(checkout, /const isFreeCart = isFreeCartTotal\(cart\.total, cart\.items\.length\);/);
  assert.match(checkout, /const effectiveMethod: CheckoutSubmitRequest\["payment_method"\] \| null = isFreeCart \? "free" : paymentMethod;/);
  assert.equal((checkout.match(/payment_method: "free"/g) ?? []).length, 1, "only submitFree sends it");
  assert.match(checkout, /\{isFreeCart \? \(\s*<StatePanel\s*variant="info"\s*title=\{i18n\.t\("checkout\.free\.title"\)\}/);
  // The card form is never prepared for a free cart.
  assert.match(checkout, /shouldInitializeCaptureContext\(effectiveMethod \?\? "", sessionId\)/);
});

test("a free order holds the attempt, re-checks the owner, and clears only after a proven order for the same session", async () => {
  const checkout = strip(await read("../app/checkout.tsx"));
  const free = section(checkout, "const submitFree = async", "const submitBlue = async");
  const order = (needle) => {
    const index = free.indexOf(needle);
    assert.ok(index >= 0, `missing: ${needle}`);
    return index;
  };
  const captured = order("cart.captureCartSession()");
  const acquired = order('acquirePaymentAttempt(sessionId, "free")');
  const blocker = order("paymentSubmitBlocker(");
  const submitted = order("checkoutService.submit(");
  const proven = order('if (freeSubmitCompletion(response) !== "complete") {');
  const current = order("if (!cart.isCartSessionCurrent(cartSessionTicket)) return;");
  const cleared = order("await cart.clearCartIfSession(cartSessionTicket)");
  const live = order("if (!cleared || !checkoutSubmissionAuthority.isCurrent(submissionTicket)) {");
  const dismissed = order("resetRouter.dismissAll?.()");
  const success = order('pathname: "/checkout/success"');
  assert.ok(cleared < live && live < dismissed && dismissed < success, "a gone or superseded submission never navigates");
  assert.ok(captured < acquired && acquired < blocker && blocker < submitted, "gate before the submit");
  assert.ok(submitted < proven && proven < current && current < cleared && cleared < success, "clear only after proof");
  assert.equal((free.match(/clearCartIfSession/g) ?? []).length, 1);
  // An unproven 2xx or an unknown failure may have created the order: locked, never retried.
  const unproven = section(free, 'if (freeSubmitCompletion(response) !== "complete") {', "if (!cart.isCartSessionCurrent(cartSessionTicket)) return;");
  assert.match(unproven, /markPaymentOutcomeUnknown\(sessionId, "free"\)/);
  assert.doesNotMatch(unproven, /settlePaymentAttempt|clearCart/);
  const failure = section(free, "} catch (err) {", "} finally {");
  assert.match(failure, /if \(failure === "unknown"\) markPaymentOutcomeUnknown\(sessionId, "free"\);\s*else if \(attempt\) void settlePaymentAttempt\(sessionId, attempt\.id\);/);
  assert.doesNotMatch(failure, /clearCart/);
  // The success screen says which provider it was: none.
  assert.match(free, /provider: "free"/);
  // The empty-cart redirect yields to the free success navigation.
  assert.match(checkout, /if \(freeOrderCompletingRef\.current\) return;/);
});

// ── Result screen ──────────────────────────────────────────────────────────

test("the free success screen says 'Order confirmed' and shows no 'Paid with' row", () => {
  const params = parseCheckoutResultParams({ provider: "free", order_id: 12, status: "paid", match_id: "7" });
  assert.equal(params.provider, "free");
  assert.equal(checkoutResultRouteParams(params).provider, "free");
  assert.equal(getCheckoutResultProviderKey("free"), null);
  const free = getCheckoutResultPresentation("success", "free");
  assert.equal(free.titleKey, "result.free.title");
  assert.equal(free.messageKey, "result.free.message");
  assert.equal(getCheckoutResultPresentation("success", "blue").titleKey, "result.success.title");
  assert.equal(getCheckoutResultPresentation("success").titleKey, "result.success.title");
  assert.equal(getCheckoutResultPresentation("failed", "free").titleKey, "result.failed.title");
  assert.equal(parseCheckoutResultParams({ provider: "freebie" }).provider, "unknown");
});

// ── Line prices (case 2) ───────────────────────────────────────────────────

test("zero-priced lines read 'Free'; a missing price never does; totals keep the amount", async () => {
  assert.equal(formatLinePrice(0, "USD"), "Free");
  assert.equal(formatLinePrice("0.00", "USD"), "Free");
  assert.equal(formatLinePrice(25, "USD"), formatMoney(25, "USD"));
  assert.equal(formatLinePrice(Number.NaN, "USD"), formatMoney(Number.NaN, "USD"));
  assert.equal(formatLinePrice(undefined, "USD"), formatMoney(undefined, "USD"));
  assert.equal(formatLinePrice(null, "USD"), formatMoney(null, "USD"));
  const summary = await read("../components/cart/OrderSummary.tsx");
  assert.match(summary, /formatLinePrice\(line\.subtotal, line\.currency\)/);
  assert.match(summary, /formatMoney\(subtotal\.amount, subtotal\.currency\)/, "subtotals stay amounts");
  const line = await read("../components/cart/CartLineItem.tsx");
  assert.match(line, /formatLinePrice\(line\.unit_price, line\.currency\)/);
  assert.match(line, /formatLinePrice\(line\.subtotal, line\.currency\)/);
});

// ── Total validation ───────────────────────────────────────────────────────

test("only a validated backend zero is free; a missing or malformed total is unavailable, never 0", async () => {
  for (const zero of [0, "0", "0.00", " 0.0 "]) {
    assert.equal(parseCartTotal(zero), 0, JSON.stringify(zero));
    assert.equal(isFreeCartTotal(parseCartTotal(zero), 1), true);
  }
  assert.equal(parseCartTotal("12.50"), 12.5);
  assert.equal(parseCartTotal(30), 30);
  for (const missing of [undefined, null, "", "   ", "abc", "0x0", "1e3", false, true, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
    const total = parseCartTotal(missing);
    assert.ok(Number.isNaN(total), `${String(missing)} is unavailable`);
    assert.equal(isFreeCartTotal(total, 2), false, `${String(missing)} never selects free checkout`);
    assert.equal(formatMoney(total, "USD"), formatMoney(undefined, "USD"), "shown as unavailable");
  }
  assert.equal(isFreeCartTotal(0, 0), false, "an empty cart is not a free order");
  // Both total readers use the validated parser; no `?? 0` fallback remains.
  const service = await read("../services/cart.ts");
  assert.match(service, /total: parseCartTotal\(candidate\.cart\.total\),/);
  assert.doesNotMatch(service, /total \?\? 0/);
  const context = await read("../context/CartContext.tsx");
  assert.match(context, /setTotal\(parseCartTotal\(response\.cart\.total\)\);/);
  assert.doesNotMatch(context, /total \?\? 0/);
});

test("match details: a zone priced 0 reads 'Free'; a null or empty price reads 'Price unavailable'", async () => {
  assert.equal(formatLinePrice("0", "USD"), "Free");
  assert.equal(formatLinePrice("0.00", "USD"), "Free");
  assert.equal(formatLinePrice(null, "USD"), formatMoney(null, "USD"));
  assert.equal(formatLinePrice("", "USD"), formatMoney("", "USD"));
  assert.equal(formatMoney("", "USD"), "Price unavailable");
  const match = await read("../app/match/[id].tsx");
  // Zone list, seat picker, and both transaction bars use the same rule.
  assert.equal((match.match(/formatLinePrice\(zone\.price, zone\.currency\)/g) ?? []).length, 1);
  assert.equal((match.match(/formatLinePrice\(selectedZone\.price, selectedZone\.currency\)/g) ?? []).length, 4);
  assert.doesNotMatch(match, /formatMoney\(/);
});
