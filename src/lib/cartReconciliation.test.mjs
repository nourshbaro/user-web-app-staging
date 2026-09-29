import assert from "node:assert/strict";
import test from "node:test";
import { checkoutReadiness, submissionGuard } from "./checkoutFlow.ts";
import {
  NO_RECONCILIATION,
  dropIfSessionEnded,
  failureIsAmbiguous,
  raiseReconciliation,
  reconciliationActive,
  releaseAfterRead,
  remainingLockKeys,
  runGroupedRemoval,
  summarizeGroupedDelete,
} from "./cartReconciliation.ts";

/**
 * Minimal model of the CartContext-owned gate: one owner, many surfaces.
 * Surfaces (Cart, cart sheet, Checkout) hold nothing; they read the owner.
 */
function createOwner(sessionId = "S1") {
  const owner = {
    sessionId,
    gate: NO_RECONCILIATION,
    raise(reason) { owner.gate = raiseReconciliation(owner.gate, owner.sessionId, reason); },
    read(confirmed, readSessionId = owner.sessionId) { owner.gate = releaseAfterRead(owner.gate, { confirmed, readSessionId }); },
    endSession(next = null) { owner.sessionId = next; owner.gate = dropIfSessionEnded(owner.gate, next); },
    active() { return reconciliationActive(owner.gate, owner.sessionId); },
  };
  return owner;
}
const surface = (owner) => ({ canMutate: () => !owner.active() });
const readyInputs = { inFlight: false, holdersComplete: true, paymentMethod: "blue", profileComplete: true, phoneValid: true };
const ownerSnapshot = (owner, extra = {}) => ({
  sessionId: owner.sessionId,
  itemCount: 2,
  expired: false,
  reconciliationRequired: owner.active(),
  paymentOutcomeUnknown: false,
  ...extra,
});

test("an unknown quantity result in Cart blocks the sheet, Checkout and both handoffs", () => {
  const owner = createOwner();
  const cart = surface(owner);
  const sheet = surface(owner);
  // updateItem timed out: the owner raises the gate (trackOutcome).
  assert.equal(failureIsAmbiguous({ status: null, transport: "timeout" }), true);
  owner.raise("unconfirmed-mutation");
  assert.equal(cart.canMutate(), false);
  assert.equal(sheet.canMutate(), false, "the sheet sees the same owner gate");
  const guard = submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(owner), ...readyInputs });
  assert.deepEqual(guard, { ok: false, blocker: "reconcile" }, "the one Pay handler guards both card and BLUE");
});

test("the gate survives surfaces unmounting and remounting", () => {
  const owner = createOwner();
  owner.raise("unconfirmed-mutation");
  const remounted = surface(owner); // a brand-new screen instance
  assert.equal(remounted.canMutate(), false);
});

test("only a confirmed read of the gated session releases it", () => {
  const owner = createOwner();
  owner.raise("unconfirmed-mutation");
  owner.read(false);
  assert.equal(owner.active(), true, "a failed refresh keeps it");
  owner.read(true, "S2");
  assert.equal(owner.active(), true, "another session's publication cannot release it");
  owner.read(true, "S1");
  assert.equal(owner.active(), false);
});

test("the gate is dropped only when the owner ends that session", () => {
  const owner = createOwner();
  owner.raise("partial-removal");
  owner.endSession("S1");
  assert.equal(owner.active(), true, "same session is never dropped");
  owner.endSession(null);
  assert.equal(owner.active(), false, "expired/cleared cart no longer exists");
  // A later session does not inherit anything.
  owner.endSession("S2");
  assert.equal(owner.active(), false);
});

test("a gate raised twice keeps its first reason; a definite 4xx does not raise it", () => {
  const first = raiseReconciliation(NO_RECONCILIATION, "S1", "partial-removal");
  assert.equal(raiseReconciliation(first, "S1", "unconfirmed-mutation"), first);
  assert.equal(failureIsAmbiguous({ status: 422, transport: null }), false);
  assert.equal(failureIsAmbiguous({ status: 409, transport: null }), false);
  assert.equal(failureIsAmbiguous({ status: 502, transport: null }), true);
  assert.equal(failureIsAmbiguous({ status: null, transport: "network" }), true);
});

test("the Pay handler rejects a render-ready state that changed before the press", () => {
  const owner = createOwner();
  const rendered = checkoutReadiness({ itemCount: 2, secondsLeft: 300, locked: false, holdersComplete: true, paymentMethod: "cybersource", profileComplete: true, phoneValid: true });
  assert.equal(rendered.ready, true);
  // Between render and press: the cart becomes unconfirmed.
  owner.raise("unconfirmed-mutation");
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(owner), ...readyInputs }).blocker, "reconcile");
  // Or: expires, or the session is replaced, or a payment became unknown.
  const clean = createOwner();
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean, { expired: true }), ...readyInputs }).blocker, "expired");
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean, { sessionId: "S2" }), ...readyInputs }).blocker, "changed");
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean, { paymentOutcomeUnknown: true }), ...readyInputs }).blocker, "paymentUnknown");
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean, { itemCount: 0 }), ...readyInputs }).blocker, "noItems");
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean), ...readyInputs, inFlight: true }).blocker, "busy");
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean), ...readyInputs, holdersComplete: false }).blocker, "holders");
  assert.equal(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean), ...readyInputs, paymentMethod: null }).blocker, "method");
  assert.deepEqual(submissionGuard({ renderedSessionId: "S1", owner: ownerSnapshot(clean), ...readyInputs }), { ok: true, blocker: null });
});

/* --------------------------- grouped removal --------------------------- */

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
const timeout = () => Object.assign(new Error("timeout"), { transport: "timeout" });
const factsOf = (error) => ({ status: error.status ?? null, transport: error.transport ?? null });

/** Fake backend cart with per-lock delete behaviour and a publishing refresh. */
function fakeRemoval({ lines = ["L1", "L2"], deleteBehaviour = {}, sessionAlive = () => true, refreshResult } = {}) {
  const state = { backend: new Set(lines), calls: [], raised: [], refreshes: 0, gate: false };
  const run = (lockKeys) => runGroupedRemoval({
    lockKeys,
    sessionId: "S1",
    isSessionCurrent: sessionAlive,
    isGateActive: () => state.gate,
    remove: async (lockKey) => {
      state.calls.push(lockKey);
      const behaviour = deleteBehaviour[lockKey];
      if (behaviour === "reject409") throw httpError(409);
      if (behaviour === "timeout") throw timeout();
      if (behaviour === "applyThenTimeout") { state.backend.delete(lockKey); throw timeout(); }
      state.backend.delete(lockKey);
    },
    refresh: async () => {
      state.refreshes += 1;
      return refreshResult ?? { confirmed: true, snapshot: { sessionId: "S1", items: [...state.backend].map((lock_key) => ({ lock_key })) } };
    },
    raiseGate: (sessionId, reason) => { state.raised.push([sessionId, reason]); state.gate = true; },
    factsOf,
  });
  return { state, run };
}

test("a fully applied grouped removal is confirmed only by the same session's publication", async () => {
  const { state, run } = fakeRemoval();
  const result = await run(["L1", "L2"]);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(result.publication.snapshot.items, []);
  assert.deepEqual(state.raised, []);
});

test("a stale session or an active gate sends nothing", async () => {
  const stale = fakeRemoval({ sessionAlive: () => false });
  assert.deepEqual(await stale.run(["L1"]), { status: "notPerformed", reason: "session-changed" });
  assert.deepEqual(stale.state.calls, []);
  const gated = fakeRemoval();
  gated.state.gate = true;
  assert.deepEqual(await gated.run(["L1"]), { status: "notPerformed", reason: "reconciliation-required" });
  assert.deepEqual(gated.state.calls, []);
});

test("a session that expires between delete and refresh is never reported as removed", async () => {
  let checks = 0;
  const { state, run } = fakeRemoval({ sessionAlive: () => (checks += 1) === 1 });
  const result = await run(["L1", "L2"]);
  assert.equal(result.status, "sessionEnded");
  assert.equal(state.refreshes, 0, "the empty cart after expiry is never read as proof");
});

test("a refresh that finds the session gone is session-ended, not removed", async () => {
  const { run } = fakeRemoval({ refreshResult: { confirmed: false, reason: "session-ended" } });
  assert.equal((await run(["L1", "L2"])).status, "sessionEnded");
});

test("first delete applied, second rejected: ambiguous, gate raised, no false removal", async () => {
  const { state, run } = fakeRemoval({ deleteBehaviour: { L2: "reject409" } });
  const result = await run(["L1", "L2"]);
  assert.deepEqual(result, { status: "ambiguous", applied: ["L1"], failed: ["L2"] });
  assert.deepEqual(state.raised, [["S1", "partial-removal"]]);
  assert.equal(state.refreshes, 1, "the owner still publishes what the backend now holds");
});

test("a delete that timed out may have applied: ambiguous even if the others failed definitely", async () => {
  const { state, run } = fakeRemoval({ deleteBehaviour: { L1: "applyThenTimeout", L2: "reject409" } });
  const result = await run(["L1", "L2"]);
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(state.raised, [["S1", "partial-removal"]]);
});

test("every delete definitely rejected: nothing changed, the rejection surfaces, no gate", async () => {
  const { state, run } = fakeRemoval({ deleteBehaviour: { L1: "reject409", L2: "reject409" } });
  await assert.rejects(run(["L1", "L2"]), /HTTP 409/);
  assert.deepEqual(state.raised, []);
});

test("an unpublished refresh after all deletes is ambiguous and raises the gate", async () => {
  const { state, run } = fakeRemoval({ refreshResult: { confirmed: false, reason: "refresh-failed" } });
  assert.equal((await run(["L1", "L2"])).status, "ambiguous");
  assert.deepEqual(state.raised, [["S1", "unconfirmed-mutation"]]);
});

test("after reconciliation a retry targets only the lines still reserved, with no replay", async () => {
  const { state, run } = fakeRemoval({ deleteBehaviour: { L2: "reject409" } });
  await run(["L1", "L2"]);
  // The explicit refresh (reconciliation) published the backend: L1 gone, L2 left.
  const published = [...state.backend].map((lock_key) => ({ lock_key }));
  state.gate = false;
  const plan = remainingLockKeys(["L1", "L2"], published);
  assert.deepEqual(plan, ["L2"]);
  // The retry now succeeds for L2 only.
  const retry = fakeRemoval({ lines: [...state.backend] });
  retry.state.calls = state.calls;
  const result = await retry.run(plan);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(state.calls, ["L1", "L2", "L2"], "L1 is never deleted twice");
});

test("settled delete summaries separate definite from ambiguous failures", () => {
  assert.deepEqual(
    summarizeGroupedDelete([{ lockKey: "a", ok: true }, { lockKey: "b", ok: true }]),
    { applied: ["a", "b"], failed: [], nothingApplied: false, allApplied: true },
  );
  assert.equal(summarizeGroupedDelete([{ lockKey: "a", ok: false, facts: { status: 404, transport: null } }]).nothingApplied, true);
  assert.equal(summarizeGroupedDelete([{ lockKey: "a", ok: false, facts: { status: 500, transport: null } }]).nothingApplied, false);
});
