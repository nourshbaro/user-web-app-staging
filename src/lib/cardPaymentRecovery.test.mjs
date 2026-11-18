/**
 * Behavioral tests for the card-payment recovery corrections: expiry while
 * CyberSource is open, a result after expiry, submit timeout / lost response
 * (never resent), repeated callbacks, restart, missing or corrupt marker
 * storage, account switching and BLUE isolation.
 *
 * The lock module is loaded fresh per "process" (only the injected stores
 * survive), so relaunch behavior is real, not simulated. React screens cannot
 * run under Node; their wiring to these behaviors is asserted on source.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { cardResultReference, cardSubmitCompletion } from "./cardPaymentResult.ts";
import {
  CARD_FORM_EXPIRY_GRACE_MS,
  cardResultSubmitBlocker,
  expiredCardFormAction,
  paymentSubmitBlocker,
} from "./checkoutFlow.ts";
import { createUnresolvedCardResultStore } from "./unresolvedCardResultStore.ts";

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
const newProcess = () => import(`./paymentOutcomeLock.ts?recovery=${(processCount += 1)}`);

function memoryBackend() {
  const values = new Map();
  return {
    values,
    get: async (key) => (values.has(key) ? values.get(key) : null),
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
}

function sessionDisk() {
  let value = null;
  return { get: async () => value, set: async (next) => { value = next; }, remove: async () => { value = null; } };
}

function devices() {
  return { primary: memoryBackend(), ledger: memoryBackend(), session: sessionDisk() };
}

async function boot(device = devices()) {
  const lock = await newProcess();
  lock.configurePaymentOutcomeStore(device.session);
  lock.configureUnresolvedCardResultStore(createUnresolvedCardResultStore({ primary: device.primary, ledger: device.ledger }));
  return { lock, device };
}

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.${"s".repeat(64)}`;
}
const paymentResult = (id = "7533511014286971803092") => jwt({ id, status: "AUTHORIZED" });

function record(lock, { accountId = "7", sessionId = "S1", result = paymentResult() } = {}) {
  return lock.recordUnresolvedCardResult({ accountId, sessionId, result, reference: cardResultReference(result) });
}

const owner = (overrides = {}) => ({
  sessionId: "S1",
  itemCount: 1,
  expired: false,
  reconciliationRequired: false,
  paymentOutcomeUnknown: false,
  paymentAttemptInProgress: false,
  ...overrides,
});

// ── Expiry while CyberSource is open ───────────────────────────────────────

test("expiry while the card form is open: the hold defers the cart owner's teardown until released", async () => {
  const { lock } = await boot();
  assert.equal(lock.isCardFormOpen("S1"), false);
  const releaseForm = lock.markCardFormOpen("S1");
  const releaseSubmit = lock.markCardFormOpen("S1"); // e.g. a re-render while the submit runs
  assert.equal(lock.isCardFormOpen("S1"), true);
  assert.equal(lock.isCardFormOpen("S2"), false, "another session is not held");
  releaseForm();
  assert.equal(lock.isCardFormOpen("S1"), true, "held while any holder remains");
  releaseSubmit();
  releaseSubmit(); // idempotent
  assert.equal(lock.isCardFormOpen("S1"), false, "released: the next countdown tick expires the cart");

  // The cart owner returns before clearing anything while the hold is on, and
  // the 1-second countdown calls it again, so the expiry is deferred, not lost.
  const context = strip(await read("../context/CartContext.tsx"));
  const expire = section(context, "const expireCart = useCallback(async () => {", "}, [resetCartDisplayState]);");
  const deferCheck = "if (isCardFormOpen(expected.sessionId) || hasHeldCardResult(expected.sessionId)) {";
  const deferIndex = expire.indexOf(deferCheck);
  assert.ok(deferIndex > 0, "defers on an active card payment or a held, never-sent result");
  assert.match(section(expire, deferCheck, "}"), /expiryDeferredForCardRef\.current = expected\.sessionId;\s*return;/);
  for (const later of ["expiryHandledRef.current = true;", "clearCartSessionIfCurrent(", "dismissEverythingAndGoHome();"]) {
    assert.ok(expire.indexOf(later) > deferIndex, `${later} only after the defer check`);
  }
  // The deferred expiry's notice never says "no payment was taken".
  assert.match(expire, /\|\| expiryDeferredForCardRef\.current === expected\.sessionId,/);
  assert.match(context, /if \(next === 0\) void expireCart\(\);/);
  const tick = section(context, "const tick = () => {", "};");
  assert.match(tick, /if \(next === 0\) void expireCart\(\);/);
  assert.match(context, /const id = setInterval\(tick, 1000\);/);
});

test("after the timer ends the open form is kept for a bounded grace period, then closed unless a result arrived", async () => {
  assert.equal(CARD_FORM_EXPIRY_GRACE_MS, 90_000);
  assert.equal(expiredCardFormAction({ resultReceived: false, elapsedMs: 0 }), "wait");
  assert.equal(expiredCardFormAction({ resultReceived: false, elapsedMs: CARD_FORM_EXPIRY_GRACE_MS - 1 }), "wait");
  assert.equal(expiredCardFormAction({ resultReceived: false, elapsedMs: CARD_FORM_EXPIRY_GRACE_MS }), "close");
  assert.equal(expiredCardFormAction({ resultReceived: true, elapsedMs: 10 * CARD_FORM_EXPIRY_GRACE_MS }), "wait", "a result being handled is never cut off");

  const card = strip(await read("../components/CardPaymentScreen.tsx"));
  // The hold covers the open form and the in-flight submit.
  assert.match(card, /const paymentActive = cardFormVisible \|\| processing;/);
  assert.match(card, /if \(!paymentActive \|\| formSessionId === null\) return;\s*return markCardFormOpen\(formSessionId\);/);
  // Expiry does not unmount the form: visibility does not depend on it...
  const visible = section(card, "const cardFormVisible =", ";");
  assert.doesNotMatch(visible, /expired|secondsLeft/);
  // ...it is covered (touches cannot start a new payment) and Back waits.
  assert.match(card, /\{formExpired && !processing \? \(/);
  assert.match(card, /backDisabled=\{processing \|\| formExpired \|\| rechecking\}/);
  assert.match(card, /useExpiredCardFormGrace\(\s*formExpired,\s*expiryGraceRef,\s*\(\) => ownResultRef\.current !== null \|\| submittingRef\.current,/);
  const hook = strip(await read("../hooks/useExpiredCardFormGrace.ts"));
  assert.match(hook, /expiredCardFormAction\(\{/);
  assert.match(hook, /if \(action === "close"\) onCloseRef\.current\(\);/);
});

// ── A payment result arriving after expiry ─────────────────────────────────

test("a card result arriving after the client timer ended is still submitted: the backend decides", async () => {
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner: owner({ expired: true }) }), null);
  // New payments (and BLUE) keep the client expiry gate.
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: owner({ expired: true }) }), "expired");
  // Everything else still blocks a card result.
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner: owner({ sessionId: "S2", expired: true }) }), "changed");
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner: owner({ itemCount: 0 }) }), "changed", "a cleared cart");
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner: owner({ reconciliationRequired: true }) }), "reconcile");
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner: owner({ paymentOutcomeUnknown: true }) }), "locked");
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner: owner({ paymentAttemptInProgress: true }) }), "inProgress");

  const card = strip(await read("../components/CardPaymentScreen.tsx"));
  assert.match(section(card, "const submitBlock = useCallback(", "const handleSuccess"), /cardResultSubmitBlocker\(\{/);
  assert.doesNotMatch(card, /paymentSubmitBlocker/);
  const checkout = strip(await read("../app/checkout.tsx"));
  assert.match(checkout, /const blocker = paymentSubmitBlocker\(\{/, "BLUE keeps the expiry gate");
});

// ── Submit timeout and lost response: unresolved, never resent ─────────────

test("a submit timeout leaves the result unresolved: its session is locked for every method, nothing is resent", async () => {
  const device = devices();
  const { lock } = await boot(device);
  lock.registerCartOwner(() => "S1");
  await lock.selectPaymentAccount("7");
  const binding = { sessionId: "S1", isAuthenticationCurrent: () => true };
  const { claim } = record(lock);
  const acquired = await lock.acquirePaymentAttempt("S1", "card", claim, binding);
  assert.equal(acquired.ok, true, "the recorder's own result passes its gate");
  // The screen's failure path after a transport error or timeout.
  assert.equal(lock.markPaymentOutcomeUnknownIfLive(binding, "card"), true);
  assert.deepEqual(lock.readPaymentOutcomeLock("S1", null, "blue"), { sessionId: "S1", method: "card" });
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "blue"), { ok: false, reason: "blocked" });
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "card", claim, binding), { ok: false, reason: "blocked" }, "not even the same result again");
  assert.equal(lock.readUnresolvedCardResults().length, 1, "the marker stays");

  // After a restart: still locked; nothing to resend exists on disk.
  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  await relaunched.lock.restorePaymentOutcomeLock("S1");
  assert.notEqual(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), null);
  assert.doesNotMatch([...device.primary.values.values(), ...device.ledger.values.values()].join("\n"), new RegExp(paymentResult().split(".")[1]), "no payment JWT on disk");

  // Source: the timeout is not turned into a retry anywhere.
  const card = strip(await read("../components/CardPaymentScreen.tsx"));
  const handle = section(card, "const handleSuccess = useCallback(", "} finally {");
  const afterSubmit = section(card, "{ authentication: snapshot },", "} finally {");
  assert.doesNotMatch(afterSubmit, /saveCardPaymentRetry|checkoutService\.submit\(/);
  assert.match(section(handle, "} catch (submissionError) {", "if (!activeRef.current) return;"), /lockHandoffSession\(\);/);
});

test("a lost response after the backend completed: the client cannot tell, so the marker stays (backend recovery required)", async () => {
  // What the app sees when the response is lost: a transport error, or a 2xx
  // whose body never arrived or did not parse (null). Neither is success.
  assert.equal(cardSubmitCompletion(null), "unresolved");
  assert.equal(cardSubmitCompletion(undefined), "unresolved");
  assert.equal(cardSubmitCompletion({ order_id: "1" }), "unresolved", "an order reference alone is not proof of payment");
  assert.equal(cardSubmitCompletion({ order_id: "1", status: "paid" }), "complete");

  const { lock } = await boot();
  await lock.selectPaymentAccount("7");
  record(lock, { sessionId: "S1" });
  const [marker] = lock.readUnresolvedCardResults();
  assert.equal(marker.reference, "7533511014286971803092", "a support reference is kept");
  assert.equal(marker.sessionId, "S1");
  // Paying again is paused only where it could duplicate: that checkout (every
  // method) and new card payments. An unrelated BLUE checkout is not blocked.
  assert.notEqual(lock.readPaymentOutcomeLock("S1", null, "blue"), null);
  assert.equal(lock.readPaymentOutcomeLock("S2")?.scope, "account");
  assert.equal(lock.readPaymentOutcomeLock("S2", null, "blue"), null);
});

// ── Repeated callbacks ─────────────────────────────────────────────────────

test("repeated payment callbacks are one record, and a repeat after resolution records nothing", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const result = paymentResult();
  const first = record(lock, { result });
  const repeat = record(lock, { result });
  assert.equal(first.claim.key, repeat.claim.key);
  assert.equal(lock.readUnresolvedCardResults().length, 1);
  assert.equal(lock.readPaymentOutcomeLock("S1", first.claim), null, "its recorder passes its own gate once");
  await Promise.all([first.persisted, repeat.persisted]);
  assert.equal(await lock.resolveUnresolvedCardResult(first.claim), "removed");
  const late = record(lock, { result });
  assert.equal(await late.persisted, true);
  assert.equal(lock.readUnresolvedCardResults().length, 0, "a late repeat of a resolved result is not recorded again");
  assert.equal(lock.readPaymentOutcomeLock("S1"), null);
});

// ── Restart ────────────────────────────────────────────────────────────────

test("app restart with an unresolved payment: briefly fail closed while reading, then its session and card stay blocked; BLUE elsewhere is free", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  assert.equal(await record(lock, { sessionId: "S1" }).persisted, true);

  const relaunched = await boot(device);
  const loading = relaunched.lock.selectPaymentAccount("7");
  assert.notEqual(relaunched.lock.readPaymentOutcomeLock("S2", null, "blue"), null, "while reading, nothing can be ruled out");
  await loading;
  assert.deepEqual(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), { sessionId: "S1", method: "card" });
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2")?.scope, "account");
  assert.deepEqual(await relaunched.lock.acquirePaymentAttempt("S2", "card"), { ok: false, reason: "blocked" });
  assert.equal((await relaunched.lock.acquirePaymentAttempt("S2", "blue")).ok, true);
});

// ── Missing or corrupt marker storage ──────────────────────────────────────

test("corrupt marker storage pauses card payments only; the persisted attempt still locks its own session", async () => {
  const device = devices();
  const { lock } = await boot(device);
  lock.registerCartOwner(() => "S1");
  await lock.selectPaymentAccount("7");
  const binding = { sessionId: "S1", isAuthenticationCurrent: () => true };
  const { claim, persisted } = record(lock, { sessionId: "S1" });
  await persisted;
  assert.equal((await lock.acquirePaymentAttempt("S1", "card", claim, binding)).ok, true);
  // Corrupt every stored marker value.
  for (const key of device.primary.values.keys()) device.primary.values.set(key, "{not json");

  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  await relaunched.lock.restorePaymentOutcomeLock("S1");
  assert.notEqual(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), null, "the attempt record locks S1 for every method");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2")?.scope, "account", "unreadable markers: card stays paused");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2", null, "blue"), null, "never an indefinite BLUE block");
  assert.equal((await relaunched.lock.acquirePaymentAttempt("S2", "blue")).ok, true);
  assert.deepEqual(relaunched.lock.readUnresolvedCardResults(), [], "nothing unreadable is shown");
});

test("missing marker storage (no store configured) pauses card payments only", async () => {
  const lock = await newProcess();
  lock.configurePaymentOutcomeStore(sessionDisk());
  lock.configureUnresolvedCardResultStore(null);
  await lock.selectPaymentAccount("7");
  assert.equal(lock.readPaymentOutcomeLock("S2")?.scope, "account");
  assert.equal(lock.readPaymentOutcomeLock("S2", null, "blue"), null);
  assert.equal((await lock.acquirePaymentAttempt("S2", "blue")).ok, true);
});

// ── Switching accounts ─────────────────────────────────────────────────────

test("switching accounts: a marker binds to its account only; switching back restores it", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  await record(lock, { accountId: "7", sessionId: "S1" }).persisted;
  await lock.selectPaymentAccount("8");
  for (const method of [undefined, "blue"]) {
    assert.equal(lock.readPaymentOutcomeLock("S1", null, method), null, `account 8, ${method ?? "card"}`);
    assert.equal(lock.readPaymentOutcomeLock("S2", null, method), null);
  }
  assert.deepEqual(lock.readUnresolvedCardResults(), [], "never shown to another account");
  await lock.selectPaymentAccount(null);
  assert.equal(lock.readPaymentOutcomeLock("S2"), null, "signed out");
  await lock.selectPaymentAccount("7");
  assert.notEqual(lock.readPaymentOutcomeLock("S1", null, "blue"), null);
  assert.equal(lock.readPaymentOutcomeLock("S2")?.scope, "account");
});

// ── BLUE isolation ─────────────────────────────────────────────────────────

test("BLUE isolation: an account card marker never blocks an unrelated BLUE checkout; session locks still block BLUE", async () => {
  const { lock } = await boot();
  await lock.selectPaymentAccount("7");
  record(lock, { sessionId: "S0" });
  // Card on any other session is paused...
  assert.deepEqual(await lock.acquirePaymentAttempt("S2", "card"), { ok: false, reason: "blocked" });
  // ...BLUE is not.
  const blue = await lock.acquirePaymentAttempt("S2", "blue");
  assert.equal(blue.ok, true);
  await lock.settlePaymentAttempt("S2", blue.attempt.id);
  assert.equal(lock.readPaymentAttempt("S2"), null, "an account block never strands BLUE's attempt");
  // A session's own unknown outcome still blocks every method on it.
  lock.markPaymentOutcomeUnknown("S2", "blue");
  assert.deepEqual(await lock.acquirePaymentAttempt("S2", "blue"), { ok: false, reason: "blocked" });
  assert.deepEqual(await lock.acquirePaymentAttempt("S2", "card"), { ok: false, reason: "blocked" });
  // The marker's own checkout blocks BLUE too.
  assert.deepEqual(await lock.acquirePaymentAttempt("S0", "blue"), { ok: false, reason: "blocked" });

  // Checkout reads BLUE gates with the BLUE view and pauses only card for the account.
  const checkout = strip(await read("../app/checkout.tsx"));
  assert.match(checkout, /paymentOutcomeUnknown: readPaymentOutcomeLock\(submissionTicket\.sessionId, null, "blue"\) !== null/);
  assert.match(checkout, /readPaymentOutcomeLock\(\s*ownerState\.sessionId,\s*null,\s*effectiveMethod === "blue" \? "blue" : effectiveMethod === "free" \? "free" : "card",\s*\)/);
  assert.match(checkout, /const paymentOutcomeUnknown = sessionPaymentUnknown \|\| \(effectiveMethod === "cybersource" && cardPausedForAccount\);/);
  assert.match(checkout, /if \(lock && lock\.scope !== "account"\) setPaymentLockSession\(lock\.sessionId\);/, "an account card pause never locks the whole checkout");
});

// ── The authorization → submit gap ─────────────────────────────────────────

test("a slow or hung marker write never delays acquiring the attempt (and so the submit)", async () => {
  const lock = await newProcess();
  lock.configurePaymentOutcomeStore(sessionDisk());
  const hung = { get: async () => null, set: () => new Promise(() => {}), remove: async () => {} };
  lock.configureUnresolvedCardResultStore(createUnresolvedCardResultStore({ primary: hung, ledger: hung }));
  lock.registerCartOwner(() => "S1");
  await lock.selectPaymentAccount("7");
  const { claim, persisted } = record(lock, { sessionId: "S1" });
  const binding = { sessionId: "S1", isAuthenticationCurrent: () => true };
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timed out"), 1000));
  const acquired = await Promise.race([lock.acquirePaymentAttempt("S1", "card", claim, binding), timeout]);
  assert.notEqual(acquired, "timed out", "the attempt does not wait behind the marker write");
  assert.equal(acquired.ok, true);
  assert.equal(await Promise.race([persisted, Promise.resolve("pending")]), "pending", "the marker write is still pending");
  assert.notEqual(lock.readPaymentOutcomeLock("S2"), null, "the in-memory marker blocks card meanwhile");
});
