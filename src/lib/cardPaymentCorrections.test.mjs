/**
 * Regression tests for the five client findings of the card-payment review:
 * A. a received result stranded by the client reservation timer;
 * B. false success from parseable 2xx error responses (see also the
 *    completion test in unresolvedCardPayment.test.mjs);
 * C. card-form lifecycle: background time, input after expiry, a form that
 *    ends without a result;
 * D. a pending marker write landing after the marker was resolved;
 * E. unreadable marker storage and BLUE on the same checkout.
 *
 * Production helpers run for real; the lock module is loaded fresh per
 * "process" (only the injected stores survive), so relaunches are real.
 * React screens cannot run under Node: their wiring is asserted on source.
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { cardResultReference, cardSubmitCompletion } from "./cardPaymentResult.ts";
import { cardFormErrorAction } from "./cardFormErrors.ts";
import {
  CARD_FORM_EXPIRY_GRACE_MS,
  GRACE_TICK_CAP_MS,
  advanceGraceElapsed,
  cardResultSubmitBlocker,
  expiredCardFormAction,
} from "./checkoutFlow.ts";
import {
  clearCardPaymentHandoff,
  createCardPaymentHandoff,
  discardStaleCardPaymentRetry,
  hasHeldCardResult,
  saveCardPaymentRetry,
  takeCardPaymentRetry,
} from "./cardPaymentHandoff.ts";
import { createCybersourceWebLifecycle } from "./cybersourceWebLifecycle.ts";
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
const flush = () => new Promise((resolve) => setImmediate(resolve));

let processCount = 0;
const newProcess = () => import(`./paymentOutcomeLock.ts?corrections=${(processCount += 1)}`);

/** A key/value backend whose writes can be held open (`hold()`), to reproduce write/resolve races. */
function memoryBackend() {
  const values = new Map();
  let gate = null;
  return {
    values,
    hold() {
      let release;
      gate = new Promise((resolve) => { release = resolve; });
      return () => { gate = null; release(); };
    },
    get: async (key) => (values.has(key) ? values.get(key) : null),
    set: async (key, value) => {
      if (gate) await gate;
      values.set(key, value);
    },
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

const card = strip(await read("../components/CardPaymentScreen.tsx"));

// ── A. A received result is never stranded by the client timer ─────────────

test("A: a held, never-sent result keeps its session from client expiry until it is sent or its session/auth ends", () => {
  const id = createCardPaymentHandoff({
    sessionId: "S1",
    accountId: "7",
    captureContext: null,
    prepareCaptureContext: () => { throw new Error("no card entry for a held result"); },
    request: { checkout_session_id: "S1", payment_method: "cybersource" },
  });
  try {
    assert.equal(hasHeldCardResult("S1"), false, "nothing held yet");
    const retry = {
      cardResult: paymentResult(),
      snapshot: { generation: 1, token: "t" },
      cartTicket: { generation: 1, sessionId: "S1" },
      claim: { key: "k", accountId: "7", sessionId: "S1" },
      attempt: { id: 1, sessionId: "S1", method: "card" },
      reference: null,
      reason: null,
      saved: true,
    };
    saveCardPaymentRetry(id, retry);
    assert.equal(hasHeldCardResult("S1"), true, "held: the cart owner defers expiry");
    assert.equal(hasHeldCardResult("S2"), false, "only its own session");
    assert.equal(hasHeldCardResult(null), false);
    // Taken for sending: the screen's own synchronous hold covers the submit.
    assert.strictEqual(takeCardPaymentRetry(id), retry);
    assert.equal(hasHeldCardResult("S1"), false);
    // Dropped when its session or authentication ends: the hold never outlives them.
    saveCardPaymentRetry(id, retry);
    discardStaleCardPaymentRetry(() => false);
    assert.equal(hasHeldCardResult("S1"), false);
  } finally {
    clearCardPaymentHandoff(id);
  }
  // The client timer alone never stops a received result; the backend decides.
  const owner = { sessionId: "S1", itemCount: 1, expired: true, reconciliationRequired: false, paymentOutcomeUnknown: false };
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner }), null);
  // A session the backend ended (cleared cart) still blocks: no bypass.
  assert.equal(cardResultSubmitBlocker({ sessionId: "S1", owner: { ...owner, sessionId: null, itemCount: 0 } }), "changed");
});

test("A: the cart owner defers expiry for a held result; the screen holds synchronously while it handles one", async () => {
  const context = strip(await read("../context/CartContext.tsx"));
  const expire = section(context, "const expireCart = useCallback(async () => {", "}, [resetCartDisplayState]);");
  assert.match(expire, /if \(isCardFormOpen\(expected\.sessionId\) \|\| hasHeldCardResult\(expected\.sessionId\)\) \{\s*expiryDeferredForCardRef\.current = expected\.sessionId;\s*return;/);

  const handle = section(card, "const handleSuccess = useCallback(", "const retrySubmission = useCallback(");
  const holdAt = handle.indexOf("const releaseExpiryHold = handoff ? markCardFormOpen(handoff.sessionId) : () => {};");
  assert.ok(holdAt > handle.indexOf("submittingRef.current = true;"), "held once the result is being handled");
  assert.ok(holdAt < handle.indexOf("try {"), "before anything awaits");
  assert.match(section(handle, "} finally {", "},"), /releaseExpiryHold\(\);/, "released when it settles");

  // Held on first delivery by the cart's re-read gate: re-read at once, then sent (once).
  assert.match(handle, /saveCardPaymentRetry\(handoffId, pending\);[\s\S]*?if \(!retry\) autoSendHeldRef\.current = true;/);
  // Not gated on the client timer anywhere it can be sent from.
  const canRetry = section(card, "const canRetry =", ";");
  assert.doesNotMatch(canRetry, /expired/);
  const checkout = strip(await read("../app/checkout.tsx"));
  assert.match(checkout, /const cardRetryHandoffId = gateVersion >= 0 \? currentCardRetry\(\) : null;/);
  assert.match(section(checkout, "const openCardRetry = () => {", "};"), /if \(handoff && !owner\.reconciliationRequired && owner\.itemCount > 0\)/);
});

// ── B. Parseable 2xx error responses are never success ─────────────────────

test("B: parseable 2xx error bodies stay unresolved and never release the marker", async () => {
  const { lock } = await boot();
  await lock.selectPaymentAccount("7");
  const { claim, persisted } = record(lock);
  await persisted;
  for (const body of [{}, { success: false }, { status: "DECLINED" }, { status: "PENDING" }, { order_id: "1", status: "paid", payment: "x" }, null]) {
    assert.equal(cardSubmitCompletion(body), "unresolved", JSON.stringify(body));
  }
  // The screen resolves only on "complete": the marker stays and keeps blocking.
  assert.equal(lock.readUnresolvedCardResults().length, 1);
  assert.equal(lock.readPaymentOutcomeLock("S1", null, "blue")?.sessionId, "S1");
  assert.equal(lock.readPaymentOutcomeLock("S1", claim), null, "only its recorder passes, as before");

  const handle = section(card, "const handleSuccess = useCallback(", "} finally {");
  const decision = handle.indexOf('if (cardSubmitCompletion(response) !== "complete") {');
  for (const consumer of ["await resolveUnresolvedCardResult(claim);", "cart.clearCartIfSession(cartTicket)", 'pathname: "/checkout/success"']) {
    assert.ok(handle.indexOf(consumer) > decision, `${consumer} only after the decision`);
  }
  // Unresolved, not failed: the unconfirmed branch locks and keeps everything.
  const unconfirmed = section(handle, 'if (cardSubmitCompletion(response) !== "complete") {', "await resolveUnresolvedCardResult(claim);");
  assert.match(unconfirmed, /lockHandoffSession\(\);/);
  assert.match(unconfirmed, /kind: "unresolved",/);
  assert.match(unconfirmed, /reference: cardSubmitOrderReference\(response\) \?\? reference,/);
  assert.doesNotMatch(unconfirmed, /settlePaymentAttempt|clearCartIfSession|notCompleted/);
});

// ── C. Card-form lifecycle ─────────────────────────────────────────────────

test("C: background time does not count toward the grace period; a late result after resume still gets the rest of it", () => {
  let elapsed = 0;
  let last = 0;
  const tick = (now) => {
    elapsed = advanceGraceElapsed(elapsed, last, now);
    last = now;
    return expiredCardFormAction({ resultReceived: false, elapsedMs: elapsed });
  };
  for (let second = 1; second <= 30; second += 1) assert.equal(tick(second * 1000), "wait");
  assert.equal(elapsed, 30_000);
  // Ten minutes in the background (timers suspended), then the first tick on resume.
  assert.equal(tick(30_000 + 600_000), "wait", "resume does not close the form at once");
  assert.equal(elapsed, 30_000 + GRACE_TICK_CAP_MS);
  // The remaining foreground time still closes it (bounded, not indefinite).
  let now = last;
  let action = "wait";
  while (action === "wait" && now < last + CARD_FORM_EXPIRY_GRACE_MS) {
    now += 1000;
    action = tick(now);
  }
  assert.equal(action, "close");
  assert.ok(elapsed >= CARD_FORM_EXPIRY_GRACE_MS && elapsed < CARD_FORM_EXPIRY_GRACE_MS + 2000);
  assert.equal(advanceGraceElapsed(0, 5000, 4000), 0, "a clock going backwards adds nothing");
});

test("C: a form that ends without a result after the payer could use it is an unknown outcome, never a cancellation", () => {
  assert.equal(cardFormErrorAction({ afterShown: false, terminated: false }), "retryInForm", "SDK never loaded: nothing could be paid");
  assert.equal(cardFormErrorAction({ afterShown: true, terminated: false }), "outcomeUnknown", "provider rejected after the form was shown");
  assert.equal(cardFormErrorAction({ afterShown: false, terminated: true }), "outcomeUnknown", "WebView process died");
  assert.equal(cardFormErrorAction({ afterShown: true, terminated: true }), "outcomeUnknown");

  const onError = section(card, "const handleFormError = useCallback(", "}, []);");
  assert.match(onError, /if \(cardFormErrorAction\(details\) !== "outcomeUnknown" \|\| !activeRef\.current\) return;/);
  assert.match(onError, /if \(ownResultRef\.current !== null \|\| submittingRef\.current\) return;/, "a delivered result keeps its own path");
  assert.match(onError, /setFailure\(\(existing\) => existing \?\? \{ kind: "formEnded" \}\);/);
  assert.match(card, /onError=\{handleFormError\}/);
  assert.match(card, /failure\?\.kind === "formEnded"\) return i18n\.t\("payment\.card\.formEnded\.message"\);|if \(failure\.kind === "formEnded"\) return i18n\.t\("payment\.card\.formEnded\.message"\);/);
});

test("C: web lifecycle reports whether a failure came after the form was mounted for the payer", async () => {
  const run = async (client) => {
    const errors = [];
    const lifecycle = createCybersourceWebLifecycle({
      captureContext: "context",
      unifiedCheckout: async () => client,
      onReady: () => {},
      onSuccess: () => {},
      onError: (message, details) => errors.push(details),
    });
    await lifecycle.start();
    await flush();
    return errors;
  };
  const checkout = (mount) => ({ on() {}, mount, destroy() {} });
  const client = (created) => ({ createCheckout: () => created, destroy() {} });
  assert.deepEqual(await run(client(Promise.resolve(checkout(() => Promise.reject(new Error("declined")))))), [{ afterShown: true }]);
  assert.deepEqual(await run(client(Promise.reject(new Error("bad context")))), [{ afterShown: false }]);
});

test("C: native bridge locks input without unmounting, and reports a dead WebView process", async () => {
  const source = await read("../components/CybersourceUnifiedCheckout.native.tsx");
  const ast = ts.createSourceFile("bridge.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "lockScript");
  assert.ok(fn, "lockScript exists");
  const js = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  // A minimal page: one focused card field.
  const appended = [];
  let blurred = 0;
  const page = {
    activeElement: { blur: () => { blurred += 1; } },
    body: { appendChild: (node) => appended.push(node) },
    getElementById: (id) => appended.find((node) => node.id === id && !node.removed) ?? null,
    createElement: () => ({ id: "", style: "", setAttribute(name, value) { this[name] = value; }, remove() { this.removed = true; } }),
  };
  const context = vm.createContext({ document: page });
  vm.runInContext(js, context);
  vm.runInContext(vm.runInContext("lockScript(true)", context), context);
  assert.equal(blurred, 1, "the focused field is blurred (closes the keyboard)");
  assert.equal(appended.length, 1, "a shield covers the page");
  assert.match(appended[0].style, /position:fixed/);
  vm.runInContext(vm.runInContext("lockScript(true)", context), context);
  assert.equal(appended.filter((node) => !node.removed).length, 1, "locking twice adds one shield");
  vm.runInContext(vm.runInContext("lockScript(false)", context), context);
  assert.equal(appended.filter((node) => !node.removed).length, 0, "unlocking removes it");

  const bridge = strip(source);
  assert.match(bridge, /onRenderProcessGone=\{handleTerminated\}/);
  assert.match(bridge, /onContentProcessDidTerminate=\{handleTerminated\}/);
  assert.match(section(bridge, "const handleTerminated = () => {", "};"), /onErrorRef\.current\(message, \{ afterShown: shownRef\.current, terminated: true \}\);/);
  assert.match(bridge, /importantForAccessibility=\{locked \? "no-hide-descendants" : "auto"\}/);
  assert.match(card, /locked=\{formExpired\}/);
});

// ── D. A late marker write never revives a resolved marker ─────────────────

test("D (regression): a marker write still running when the marker is resolved cannot revive it, even after a relaunch", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const release = device.primary.hold(); // the marker write starts and stalls mid-write
  const { claim, persisted } = record(lock, { sessionId: "S1" });
  await flush();
  await flush();
  // The submit completed while the write was still running.
  const resolution = lock.resolveUnresolvedCardResult(claim);
  assert.equal(lock.readUnresolvedCardResults().length, 0, "resolved at once in this process");
  release(); // the stalled write now lands
  assert.equal(await persisted, true);
  assert.equal(await resolution, "removed", "the removal ran after the write, not instead of it");

  // A new process (module memory gone) reads only storage.
  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  assert.deepEqual(relaunched.lock.readUnresolvedCardResults(), [], "not revived");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2"), null, "card is not paused by a resolved marker");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), null);
});

test("D: a marker resolved before its write even started is never written; one never written resolves without storage", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const release = device.primary.hold();
  const first = record(lock, { sessionId: "S1", result: paymentResult("1000000001") });
  const second = record(lock, { sessionId: "S1", result: paymentResult("1000000002") }); // queued behind the first
  await flush();
  const secondResolved = lock.resolveUnresolvedCardResult(second.claim);
  release();
  await Promise.all([first.persisted, second.persisted, secondResolved]);
  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  assert.deepEqual(relaunched.lock.readUnresolvedCardResults().map((marker) => marker.key), [first.claim.key], "only the unresolved one survives");

  const offline = await newProcess();
  offline.configurePaymentOutcomeStore(sessionDisk());
  offline.configureUnresolvedCardResultStore(null);
  await offline.selectPaymentAccount("7");
  const local = record(offline, { sessionId: "S9" });
  assert.equal(await local.persisted, false);
  assert.equal(await offline.resolveUnresolvedCardResult(local.claim), "removed", "nothing durable to remove");
});

// ── E. Unreadable storage and BLUE on the same checkout ────────────────────

async function corruptAfterRecording({ withAttemptRecord }) {
  const device = devices();
  const { lock } = await boot(device);
  lock.registerCartOwner(() => "S1");
  await lock.selectPaymentAccount("7");
  const { claim, persisted } = record(lock, { sessionId: "S1" });
  await persisted;
  if (withAttemptRecord) await lock.acquirePaymentAttempt("S1", "card", claim, { sessionId: "S1", isAuthenticationCurrent: () => true });
  const good = new Map(device.primary.values);
  for (const key of device.primary.values.keys()) device.primary.values.set(key, "{corrupt");
  return { device, repair: () => { device.primary.values.clear(); for (const [key, value] of good) device.primary.values.set(key, value); } };
}

test("E: unreadable markers block every method on a checkout restored from an earlier launch, with an explicit reason", async () => {
  // No attempt record: the result was held back (never sent), so only the marker knew about S1.
  const { device, repair } = await corruptAfterRecording({ withAttemptRecord: false });
  const relaunched = await boot(device);
  await relaunched.lock.restorePaymentOutcomeLock("S1"); // the cart owner restores S1
  await relaunched.lock.selectPaymentAccount("7");
  assert.deepEqual(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), { sessionId: "S1", method: "card", reason: "unreadable" });
  assert.deepEqual(await relaunched.lock.acquirePaymentAttempt("S1", "blue"), { ok: false, reason: "blocked" }, "no conflicting BLUE payment");
  assert.deepEqual(await relaunched.lock.acquirePaymentAttempt("S1", "card"), { ok: false, reason: "blocked" });
  // A new checkout is not affected for BLUE; card stays paused for the account.
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2", null, "blue"), null);
  assert.equal((await relaunched.lock.acquirePaymentAttempt("S2", "blue")).ok, true);
  await relaunched.lock.settlePaymentAttempt("S2");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2")?.scope, "account");
  // Another account is never affected.
  await relaunched.lock.selectPaymentAccount("8");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), null);
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2"), null);
  // Retrying the read once storage is readable replaces the uncertainty with the real marker.
  repair();
  await relaunched.lock.selectPaymentAccount("7");
  assert.deepEqual(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), { sessionId: "S1", method: "card" }, "the real marker still blocks S1");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2", null, "blue"), null);
});

test("E: a retried read that finds no marker releases the restored checkout", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  await record(lock, { sessionId: "S0" }).persisted; // an old marker for another checkout
  const good = new Map(device.primary.values);
  for (const key of device.primary.values.keys()) device.primary.values.set(key, "{corrupt");
  const relaunched = await boot(device);
  await relaunched.lock.restorePaymentOutcomeLock("S1");
  await relaunched.lock.selectPaymentAccount("7");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue")?.reason, "unreadable");
  for (const [key, value] of good) device.primary.values.set(key, value);
  await relaunched.lock.selectPaymentAccount("7");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S1", null, "blue"), null, "S1 had no marker: BLUE is free again");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S1")?.scope, "account", "card stays paused by the S0 marker");
});

test("E: a marker recorded in this process blocks its checkout for BLUE even while storage is unavailable", async () => {
  const lock = await newProcess();
  lock.configurePaymentOutcomeStore(sessionDisk());
  lock.configureUnresolvedCardResultStore(null);
  await lock.selectPaymentAccount("7");
  record(lock, { sessionId: "S1" });
  assert.deepEqual(lock.readPaymentOutcomeLock("S1", null, "blue"), { sessionId: "S1", method: "card" });
  assert.equal(lock.readPaymentOutcomeLock("S2", null, "blue"), null, "a checkout first seen in this process has no hidden marker");
});

test("E: checkout explains the unreadable state and offers a retried read", async () => {
  const checkout = strip(await read("../app/checkout.tsx"));
  assert.match(checkout, /readPaymentOutcomeLock\(cart\.sessionId, null, "blue"\)\?\.reason === "unreadable"/);
  const panel = section(checkout, "sessionRecordUnreadable && !cardRetryHandoffId ? (", "/>");
  assert.match(panel, /checkout\.paymentUnknown\.unreadableMessage/);
  assert.match(panel, /onPress: recheckPaymentRecord/);
  assert.match(section(checkout, "const recheckPaymentRecord = () => {", "};"), /selectPaymentAccount\(accountId\)/);
  assert.match(card, /if \(failure\.kind === "locked" && failure\.unreadable\) return i18n\.t\("checkout\.paymentUnknown\.unreadableMessage"\);/);
});
