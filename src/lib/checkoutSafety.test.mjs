import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  blueSuccessCompletion,
  canLeavePayment,
  checkoutAttemptBlocks,
  paymentFailureKind,
  paymentSubmitBlocker,
  submissionGuard,
} from "./checkoutFlow.ts";
import {
  acquirePaymentAttempt,
  clearPaymentOutcomeLockUnlessSession,
  configurePaymentOutcomeStore,
  discardPaymentOutcomeUnlessSession,
  isPaymentAttemptHeldByOther,
  markPaymentOutcomeUnknown,
  readPaymentAttempt,
  readPaymentOutcomeLock,
  restorePaymentOutcomeLock,
  settlePaymentAttempt,
} from "./paymentOutcomeLock.ts";

/** Acquire and report only whether the attempt was recorded (restart tests). */
const recordPaymentAttempt = async (sessionId, method) => (await acquirePaymentAttempt(sessionId, method)).ok;

beforeEach(() => {
  configurePaymentOutcomeStore(null);
  clearPaymentOutcomeLockUnlessSession(null);
});

/** Persisted storage that outlives the "process" (the module's memory). */
function persistentStore({ failGet = false, failSet = false, initial = null } = {}) {
  let value = initial;
  return {
    read: () => value,
    store: {
      get: async () => {
        if (failGet) throw new Error("storage unavailable");
        return value;
      },
      set: async (next) => {
        if (failSet) throw new Error("storage unavailable");
        value = next;
      },
      remove: async () => {
        value = null;
      },
    },
  };
}

/** Process death: module memory is gone, persisted storage is not. */
function restartProcess() {
  clearPaymentOutcomeLockUnlessSession(null);
}

const ready = { inFlight: false, holdersComplete: true, paymentMethod: "blue", profileComplete: true, phoneValid: true };
const owner = (sessionId, paymentOutcomeUnknown, paymentAttemptInProgress = false) => ({
  sessionId,
  itemCount: 2,
  expired: false,
  reconciliationRequired: false,
  paymentOutcomeUnknown,
  paymentAttemptInProgress,
});
/** What Checkout's Pay handler decides for the current session (mirrors handleContinue). */
const canPay = (sessionId, paymentMethod = "blue", hasReusableBlueAttempt = false) =>
  submissionGuard({
    renderedSessionId: sessionId,
    owner: owner(
      sessionId,
      readPaymentOutcomeLock(sessionId) !== null,
      checkoutAttemptBlocks({ heldMethod: readPaymentAttempt(sessionId)?.method ?? null, paymentMethod, hasReusableBlueAttempt }),
    ),
    ...ready,
    paymentMethod,
  });

/** What a payment surface's final pre-submit guard decides (mirrors submitBlock / submitBlue). */
const finalGuard = (sessionId, own) =>
  paymentSubmitBlocker({
    sessionId,
    owner: owner(sessionId, readPaymentOutcomeLock(sessionId) !== null, isPaymentAttemptHeldByOther(sessionId, own)),
  });

/** The screens' policy: only an unknown outcome locks the session. */
function onSubmitFailure(sessionId, method, facts) {
  const kind = paymentFailureKind(facts);
  if (kind === "unknown") markPaymentOutcomeUnknown(sessionId, method);
  return kind;
}

/* ------------------------- unknown payment outcome ------------------------ */

test("a BLUE submit timeout or server error blocks paying again for that session", () => {
  assert.equal(onSubmitFailure("S1", "blue", { status: null, transport: "timeout" }), "unknown");
  assert.deepEqual(canPay("S1"), { ok: false, blocker: "paymentUnknown" });
  clearPaymentOutcomeLockUnlessSession(null);
  assert.equal(onSubmitFailure("S1", "blue", { status: 502, transport: null }), "unknown");
  assert.equal(canPay("S1").blocker, "paymentUnknown");
});

test("a definite rejection keeps the existing retry behaviour", () => {
  assert.equal(onSubmitFailure("S1", "blue", { status: 422, transport: null }), "notCompleted");
  assert.equal(onSubmitFailure("S1", "card", { status: 402, transport: null }), "notCompleted");
  assert.equal(readPaymentOutcomeLock("S1"), null);
  assert.deepEqual(canPay("S1"), { ok: true, blocker: null });
});

test("an unknown card outcome still blocks after leaving and returning to Checkout", () => {
  onSubmitFailure("S1", "card", { status: null, transport: "network" });
  // The card screen unmounts; Checkout re-reads the session-scoped lock on focus.
  assert.deepEqual(readPaymentOutcomeLock("S1"), { sessionId: "S1", method: "card" });
  assert.equal(canPay("S1").blocker, "paymentUnknown", "no second handoff for the same session");
});

test("a new cart session does not inherit a stale unknown-payment lock", () => {
  onSubmitFailure("S1", "blue", { status: null, transport: "timeout" });
  assert.equal(readPaymentOutcomeLock("S2"), null);
  assert.deepEqual(canPay("S2"), { ok: true, blocker: null });
  assert.equal(readPaymentOutcomeLock(null), null);
});

/* --------------------------- BLUE clear outcomes -------------------------- */

test("a classified BLUE success is success only when this session's cart was cleared", () => {
  assert.equal(blueSuccessCompletion({ handoffSessionId: "S1", currentSessionId: "S1", clear: "cleared" }), "success");
});

test("a clear that returns nothing or rejects is never success and locks the session", () => {
  for (const clear of ["notCleared", "threw"]) {
    assert.equal(blueSuccessCompletion({ handoffSessionId: "S1", currentSessionId: "S1", clear }), "unreconciled", clear);
  }
  // The screen then locks the handoff's session and offers My Tickets.
  markPaymentOutcomeUnknown("S1", "blue");
  assert.equal(canPay("S1").blocker, "paymentUnknown");
});

test("a success for another or no reservation is unmatched and nothing is cleared or retried", () => {
  assert.equal(blueSuccessCompletion({ handoffSessionId: "S1", currentSessionId: "S2", clear: "notAttempted" }), "unmatched");
  assert.equal(blueSuccessCompletion({ handoffSessionId: null, currentSessionId: "S1", clear: "notAttempted" }), "unmatched");
  assert.equal(blueSuccessCompletion({ handoffSessionId: "S1", currentSessionId: null, clear: "notAttempted" }), "unmatched");
  // Even if a caller somehow reported a clear, a session mismatch never becomes success.
  assert.equal(blueSuccessCompletion({ handoffSessionId: "S1", currentSessionId: "S2", clear: "cleared" }), "unmatched");
});

test("a terminal success is processed once: repeated terminal URLs do not retry the clear", async () => {
  // Mirrors the screen's terminalHandledRef + single clear attempt.
  const handled = { current: false };
  let clears = 0;
  const handleTerminal = async () => {
    if (handled.current) return "ignored";
    handled.current = true;
    try {
      clears += 1;
      throw new Error("persistence failed");
    } catch {
      return blueSuccessCompletion({ handoffSessionId: "S1", currentSessionId: "S1", clear: "threw" });
    }
  };
  assert.equal(await handleTerminal(), "unreconciled");
  assert.equal(await handleTerminal(), "ignored");
  assert.equal(clears, 1);
});

/* ------------------------ restart / session restore ------------------------ */

test("an unknown card outcome stays locked after the process restarts and the same session is restored", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  assert.equal(await recordPaymentAttempt("S1", "card"), true, "recorded before the submit is sent");
  onSubmitFailure("S1", "card", { status: null, transport: "timeout" });
  assert.equal(canPay("S1").blocker, "paymentUnknown");

  restartProcess();
  // Without the persisted record this is exactly Codex's finding: memory is gone.
  assert.equal(readPaymentOutcomeLock("S1"), null);
  // CartContext restores the persisted cart session and, first, its lock.
  await restorePaymentOutcomeLock("S1");
  assert.equal(canPay("S1").blocker, "paymentUnknown", "no second payment for the restored session");
});

test("a submission interrupted by process death (no answer at all) is locked after restart", async () => {
  for (const method of ["card", "blue"]) {
    const disk = persistentStore();
    configurePaymentOutcomeStore(disk.store);
    // Recorded, then the request (or the BLUE WebView) never reached a result.
    assert.equal(await recordPaymentAttempt("S1", method), true);
    restartProcess();
    await restorePaymentOutcomeLock("S1");
    assert.deepEqual(readPaymentOutcomeLock("S1"), { sessionId: "S1", method }, method);
    assert.equal(canPay("S1").blocker, "paymentUnknown", method);
    clearPaymentOutcomeLockUnlessSession(null);
  }
});

test("a definite rejection settles the attempt, so a restart keeps the existing retry behaviour", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  await recordPaymentAttempt("S1", "card");
  assert.equal(onSubmitFailure("S1", "card", { status: 422, transport: null }), "notCompleted");
  await settlePaymentAttempt("S1");
  assert.equal(disk.read(), null);
  restartProcess();
  await restorePaymentOutcomeLock("S1");
  assert.deepEqual(canPay("S1"), { ok: true, blocker: null });
});

test("settling never releases a session whose outcome is unknown", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  await recordPaymentAttempt("S1", "blue");
  markPaymentOutcomeUnknown("S1", "blue");
  await settlePaymentAttempt("S1");
  restartProcess();
  await restorePaymentOutcomeLock("S1");
  assert.equal(canPay("S1").blocker, "paymentUnknown");
});

test("a stale record never blocks an unrelated or new session and is discarded", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  await recordPaymentAttempt("S1", "card");
  markPaymentOutcomeUnknown("S1", "card");

  restartProcess();
  await restorePaymentOutcomeLock("S2");
  assert.deepEqual(canPay("S2"), { ok: true, blocker: null });
  assert.equal(disk.read(), null, "the other session's record is removed");

  // Signed out / no persisted session / expired session: nothing survives.
  await recordPaymentAttempt("S3", "card");
  restartProcess();
  await restorePaymentOutcomeLock(null);
  assert.equal(disk.read(), null);

  // A new session published during the process drops the old lock and record.
  await recordPaymentAttempt("S4", "blue");
  markPaymentOutcomeUnknown("S4", "blue");
  await discardPaymentOutcomeUnlessSession("S5");
  assert.equal(readPaymentOutcomeLock("S4"), null);
  assert.equal(disk.read(), null);
  assert.deepEqual(canPay("S5"), { ok: true, blocker: null });
});

test("the same session keeps its lock when the owner republishes it", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  await recordPaymentAttempt("S1", "card");
  markPaymentOutcomeUnknown("S1", "card");
  await discardPaymentOutcomeUnlessSession("S1");
  await restorePaymentOutcomeLock("S1");
  assert.equal(canPay("S1").blocker, "paymentUnknown");
  assert.notEqual(disk.read(), null);
});

test("restore fails closed for the restored session when the record cannot be read", async () => {
  configurePaymentOutcomeStore(persistentStore({ failGet: true }).store);
  await restorePaymentOutcomeLock("S1");
  assert.equal(canPay("S1").blocker, "paymentUnknown");
  // …but never locks a session that is not being restored.
  assert.equal(readPaymentOutcomeLock("S2"), null);

  clearPaymentOutcomeLockUnlessSession(null);
  const corrupt = persistentStore({ initial: "{not json" });
  configurePaymentOutcomeStore(corrupt.store);
  await restorePaymentOutcomeLock("S1");
  assert.equal(canPay("S1").blocker, "paymentUnknown", "an unreadable record cannot rule out an attempt");
  assert.deepEqual(JSON.parse(corrupt.read()), { version: 1, sessionId: "S1", method: "unknown" });
});

test("a submission that cannot be recorded is not sent, and does not keep the gate", async () => {
  assert.deepEqual(await acquirePaymentAttempt("S1", "card"), { ok: false, reason: "notRecorded" }, "no store configured");
  configurePaymentOutcomeStore(persistentStore({ failSet: true }).store);
  assert.deepEqual(await acquirePaymentAttempt("S1", "blue"), { ok: false, reason: "notRecorded" }, "write failed");
  assert.equal(readPaymentAttempt("S1"), null, "a failed claim is released");
  assert.deepEqual(canPay("S1", "cybersource"), { ok: true, blocker: null });
});

/* --------------------- one shared same-session attempt --------------------- */

test("Card acquires the attempt → BLUE tries before Card resolves → BLUE is blocked", async () => {
  configurePaymentOutcomeStore(persistentStore().store);
  const card = await acquirePaymentAttempt("S1", "card");
  assert.equal(card.ok, true);
  // Checkout's Pay handler refuses BLUE…
  assert.deepEqual(canPay("S1", "blue"), { ok: false, blocker: "attemptInProgress" });
  // …BLUE's own acquisition is refused…
  assert.deepEqual(await acquirePaymentAttempt("S1", "blue"), { ok: false, reason: "blocked" });
  // …and a competing surface's final guard (no own attempt) is refused.
  assert.equal(finalGuard("S1", null), "inProgress");
});

test("BLUE acquires the attempt → Card tries before BLUE resolves → Card is blocked", async () => {
  configurePaymentOutcomeStore(persistentStore().store);
  const blue = await acquirePaymentAttempt("S1", "blue");
  assert.equal(blue.ok, true);
  // e.g. the BLUE page was left without a result, and Card is chosen:
  assert.deepEqual(canPay("S1", "cybersource"), { ok: false, blocker: "attemptInProgress" }, "no card handoff");
  assert.equal(finalGuard("S1", null), "inProgress", "the card screen's token-time guard");
  assert.deepEqual(await acquirePaymentAttempt("S1", "card"), { ok: false, reason: "blocked" });
  // A fresh BLUE submit is blocked too; only continuing the held BLUE URL is allowed.
  assert.equal(canPay("S1", "blue", false).blocker, "attemptInProgress");
  assert.deepEqual(canPay("S1", "blue", true), { ok: true, blocker: null });
});

test("two surfaces acquiring in the same tick: exactly one holds the attempt", async () => {
  configurePaymentOutcomeStore(persistentStore().store);
  const [card, blue] = await Promise.all([acquirePaymentAttempt("S1", "card"), acquirePaymentAttempt("S1", "blue")]);
  assert.equal(card.ok, true);
  assert.deepEqual(blue, { ok: false, reason: "blocked" });
});

test("the owning Card attempt passes its own final guard", async () => {
  configurePaymentOutcomeStore(persistentStore().store);
  const card = await acquirePaymentAttempt("S1", "card");
  assert.equal(finalGuard("S1", card.attempt), null, "owner may submit");
  assert.equal(finalGuard("S1", null), "inProgress", "no one else may");
  // Its own guard still enforces expiry.
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...owner("S1", false, isPaymentAttemptHeldByOther("S1", card.attempt)), expired: true } }), "expired");
});

test("the owning BLUE attempt passes its own final guard", async () => {
  configurePaymentOutcomeStore(persistentStore().store);
  const blue = await acquirePaymentAttempt("S1", "blue");
  assert.equal(finalGuard("S1", blue.attempt), null, "owner may submit");
  assert.equal(finalGuard("S1", null), "inProgress");
  // A different acquisition identity for the same session is not the owner.
  assert.equal(finalGuard("S1", { ...blue.attempt, id: blue.attempt.id + 1000 }), "inProgress");
});

test("a definite non-completion releases the attempt; only its owner can settle it", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  const card = await acquirePaymentAttempt("S1", "card");
  // A settle carrying another identity changes nothing.
  await settlePaymentAttempt("S1", card.attempt.id + 1000);
  assert.notEqual(readPaymentAttempt("S1"), null);
  // Card: backend rejection (4xx).
  assert.equal(onSubmitFailure("S1", "card", { status: 422, transport: null }), "notCompleted");
  await settlePaymentAttempt("S1", card.attempt.id);
  assert.equal(readPaymentAttempt("S1"), null);
  assert.equal(disk.read(), null);
  assert.deepEqual(canPay("S1", "blue"), { ok: true, blocker: null }, "the other method may now pay");
  // BLUE: provider failure redirect (settled by session, as BluePaymentScreen does).
  const blue = await acquirePaymentAttempt("S1", "blue");
  assert.equal(blue.ok, true);
  await settlePaymentAttempt("S1");
  assert.equal(readPaymentAttempt("S1"), null);
  assert.deepEqual(canPay("S1", "cybersource"), { ok: true, blocker: null });
});

test("an unknown outcome turns the attempt into the lock and stays locked (also after restart)", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  const card = await acquirePaymentAttempt("S1", "card");
  onSubmitFailure("S1", "card", { status: null, transport: "network" });
  assert.equal(readPaymentAttempt("S1"), null, "the lock supersedes the attempt");
  await settlePaymentAttempt("S1", card.attempt.id);
  assert.equal(canPay("S1", "blue").blocker, "paymentUnknown");
  assert.deepEqual(await acquirePaymentAttempt("S1", "blue"), { ok: false, reason: "blocked" });
  assert.equal(finalGuard("S1", card.attempt), "locked", "not even the former owner");
  restartProcess();
  await restorePaymentOutcomeLock("S1");
  assert.equal(canPay("S1", "cybersource").blocker, "paymentUnknown");
});

test("a new or different session is not blocked by a stale attempt", async () => {
  const disk = persistentStore();
  configurePaymentOutcomeStore(disk.store);
  await acquirePaymentAttempt("S1", "blue");
  // Another session never reads S1's attempt…
  assert.equal(readPaymentAttempt("S2"), null);
  assert.deepEqual(canPay("S2", "cybersource"), { ok: true, blocker: null });
  // …and once CartContext publishes S2, S1's attempt and record are discarded.
  await discardPaymentOutcomeUnlessSession("S2");
  assert.equal(readPaymentAttempt("S1"), null);
  assert.equal(disk.read(), null);
  const next = await acquirePaymentAttempt("S2", "card");
  assert.equal(next.ok, true);
  assert.equal(finalGuard("S2", next.attempt), null);
});

test("in the same process, restoring the held session keeps it an attempt (the owner is not locked out)", async () => {
  configurePaymentOutcomeStore(persistentStore().store);
  const blue = await acquirePaymentAttempt("S1", "blue");
  await restorePaymentOutcomeLock("S1");
  assert.equal(readPaymentOutcomeLock("S1"), null);
  assert.equal(finalGuard("S1", blue.attempt), null);
  assert.equal(finalGuard("S1", null), "inProgress");
});

/* ------------------------ expiry during card handoff ----------------------- */

test("a reservation that expires while the card form is open blocks the submit", () => {
  const active = { sessionId: "S1", itemCount: 2, expired: false, reconciliationRequired: false, paymentOutcomeUnknown: false };
  // Valid when Checkout hands off to the card screen…
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: active, ...ready, paymentMethod: "cybersource" }).ok, true);
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: active }), null);
  // …the countdown reaches zero while the card form is open, the token returns:
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...active, expired: true } }), "expired");
  // …or the owner already cleared the expired session.
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...active, sessionId: null, itemCount: 0 } }), "changed");
});

test("the last pre-submit check also covers a changed, gated or locked session", () => {
  const owner = { sessionId: "S1", itemCount: 1, expired: false, reconciliationRequired: false, paymentOutcomeUnknown: false };
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...owner, sessionId: "S2" } }), "changed");
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...owner, itemCount: 0 } }), "changed");
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...owner, reconciliationRequired: true } }), "reconcile");
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...owner, paymentOutcomeUnknown: true } }), "locked");
  // Expiry wins over the gate/lock: the reservation is gone either way.
  assert.equal(paymentSubmitBlocker({ sessionId: "S1", owner: { ...owner, expired: true, paymentOutcomeUnknown: true } }), "expired");
});

/* ------------------------------ card back race ----------------------------- */

test("card back is refused synchronously from the moment submission starts", () => {
  const submittingRef = { current: false };
  let navigations = 0;
  const onBack = () => { if (canLeavePayment(submittingRef)) navigations += 1; };
  onBack();
  assert.equal(navigations, 1, "before submit, back works");
  // handleSuccess sets the ref; React has not re-rendered yet.
  submittingRef.current = true;
  onBack();
  onBack();
  assert.equal(navigations, 1, "header and hardware back both refused before any re-render");
  // A definite result (success or failure) releases it.
  submittingRef.current = false;
  onBack();
  assert.equal(navigations, 2);
});
