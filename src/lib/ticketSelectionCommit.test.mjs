import assert from "node:assert/strict";
import test from "node:test";
import { confirmedPublication, unconfirmedPublication } from "./cartPublication.ts";
import {
  actionableSeatDraft,
  cartLinesByZone,
  cartReflectsPlan,
  commitEffects,
  executeSelectionCommit,
  gaCartChanges,
  resolveDraftQuantity,
  seatTouchTarget,
  selectionPreflight,
} from "./ticketSelection.ts";

const MATCH = "7";

/**
 * Minimal model of the owner contract: a backend cart per session plus the
 * owner's published view. Each operation applies to the backend first, then
 * publishes (or fails to publish) exactly like CartContext's return contract.
 */
function fakeOwner({ sessionId = "S1", lines = [] } = {}) {
  const state = {
    sessionId,
    backend: new Map([[sessionId, lines.map((line) => ({ ...line }))]]),
    published: lines.map((line) => ({ ...line })),
    calls: [],
    // Per-call behaviour overrides, consumed in order: "ok" | "unpublished" | "throw" | "refresh-fails" | "session-swap"
    script: [],
  };
  let nextLock = 100;
  const backend = () => state.backend.get(state.sessionId) ?? [];
  const publish = () => {
    state.published = backend().map((line) => ({ ...line }));
    return confirmedPublication(state.sessionId, state.published);
  };
  const run = async (name, apply) => {
    state.calls.push(name);
    const mode = state.script.shift() ?? "ok";
    if (mode === "throw") throw Object.assign(new Error("rejected"), { status: 409 });
    if (mode === "session-swap") {
      // Backend rejects the session; the owner recovers into a new, empty session and applies there.
      state.sessionId = `${state.sessionId}-new`;
      state.backend.set(state.sessionId, []);
    }
    apply(backend());
    if (mode === "unpublished") return unconfirmedPublication("session-changed");
    if (mode === "refresh-fails") return unconfirmedPublication("refresh-failed");
    return publish();
  };
  const ops = {
    addZone: (zoneId, quantity) =>
      run(`add:${zoneId}:${quantity}`, (cart) => {
        const existing = cart.find((line) => line.type === "zone" && Number(line.stadium_zone_id) === zoneId);
        if (existing) existing.quantity = Number(existing.quantity) + quantity; // backend merge is additive
        else cart.push({ lock_key: `L${nextLock++}`, match_id: MATCH, stadium_zone_id: String(zoneId), type: "zone", quantity });
      }),
    setZone: (lockKey, quantity) =>
      run(`set:${lockKey}:${quantity}`, (cart) => {
        const line = cart.find((item) => item.lock_key === lockKey);
        if (line) line.quantity = quantity;
      }),
    removeLine: (lockKey) =>
      run(`remove:${lockKey}`, (cart) => {
        const index = cart.findIndex((item) => item.lock_key === lockKey);
        if (index >= 0) cart.splice(index, 1);
      }),
    addSeats: (zoneId, seatIds) =>
      run(`seats:${zoneId}:${seatIds.join(",")}`, (cart) => {
        cart.push({ lock_key: `L${nextLock++}`, match_id: MATCH, stadium_zone_id: String(zoneId), type: "seats", quantity: seatIds.length, seat_ids: [...seatIds] });
      }),
    currentSessionId: () => state.sessionId,
  };
  return { state, ops };
}

const zones = [
  { id: 1, has_seats: false },
  { id: 2, has_seats: false },
  { id: 5, has_seats: true },
];

/** What the screen does: diff drafts against the owner's published cart. */
function planFrom(owner, drafts, seats = null) {
  const cartByZone = cartLinesByZone(owner.state.published, MATCH);
  return {
    matchId: MATCH,
    gaChanges: gaCartChanges(zones, (zoneId) => resolveDraftQuantity(drafts, cartByZone, zoneId), cartByZone),
    seats,
  };
}

test("remove with an authoritative refresh confirms; the line is gone from the published cart", async () => {
  const owner = fakeOwner({ lines: [{ lock_key: "A", match_id: MATCH, stadium_zone_id: "1", type: "zone", quantity: 2 }] });
  const plan = planFrom(owner, new Map([[1, 0]]));
  assert.equal(plan.gaChanges[0].action, "remove");
  const outcome = await executeSelectionCommit(plan, owner.ops);
  assert.deepEqual(outcome, { status: "confirmed" });
  assert.deepEqual(commitEffects(outcome, null), { success: true, needsReconcile: false });
  assert.equal(cartLinesByZone(owner.state.published, MATCH).has(1), false);
});

test("remove resolves but the post-delete refresh fails: no success, drafts kept, reconcile required", async () => {
  const owner = fakeOwner({ lines: [{ lock_key: "A", match_id: MATCH, stadium_zone_id: "1", type: "zone", quantity: 2 }] });
  owner.state.script = ["refresh-fails"];
  const outcome = await executeSelectionCommit(planFrom(owner, new Map([[1, 0]])), owner.ops);
  assert.equal(outcome.status, "unconfirmed");
  const effects = commitEffects(outcome, null);
  assert.equal(effects.success, false, "no success toast, no navigation, no draft clearing");
  assert.equal(effects.needsReconcile, true);
});

test("a session change during confirmation is never success, even when every call resolved", async () => {
  // GA zone 1 lands in S1; the seat add is recovered into a new session, so S1's line is not in the final cart.
  const owner = fakeOwner();
  owner.state.script = ["ok", "session-swap"];
  const plan = planFrom(owner, new Map([[1, 2]]), { zoneId: 5, seatIds: [11] });
  const outcome = await executeSelectionCommit(plan, owner.ops);
  assert.equal(outcome.status, "unconfirmed");
  assert.equal(commitEffects(outcome, null).success, false);
});

test("the owner's current session must match the last published snapshot", async () => {
  const owner = fakeOwner();
  const ops = { ...owner.ops, currentSessionId: () => "someone-else" };
  const outcome = await executeSelectionCommit(planFrom(owner, new Map([[1, 1]])), ops);
  assert.equal(outcome.status, "unconfirmed");
});

test("add or update whose publication is not confirmed is not success, and the sequence stops", async () => {
  for (const mode of ["unpublished", "refresh-fails"]) {
    const owner = fakeOwner({ lines: [{ lock_key: "B", match_id: MATCH, stadium_zone_id: "2", type: "zone", quantity: 1 }] });
    owner.state.script = [mode];
    const outcome = await executeSelectionCommit(planFrom(owner, new Map([[1, 2], [2, 3]])), owner.ops);
    assert.deepEqual(outcome, { status: "unconfirmed", completedSteps: 1 }, mode);
    assert.equal(owner.state.calls.length, 1, "no further mutation after an unconfirmed step");
  }
});

test("partial success: A publishes, B is rejected; the retry sends only B", async () => {
  const owner = fakeOwner();
  owner.state.script = ["ok", "throw"];
  const drafts = new Map([[1, 2], [2, 3]]);
  const first = await executeSelectionCommit(planFrom(owner, drafts), owner.ops);
  assert.equal(first.status, "failed");
  assert.equal(first.completedSteps, 1);
  const effects = commitEffects(first, "unavailable");
  assert.deepEqual(effects, { success: false, needsReconcile: false }, "a definite rejection needs no reconcile");

  // Drafts were kept; the next plan is re-diffed against the published cart, so A is not resent.
  const retry = planFrom(owner, drafts);
  assert.deepEqual(retry.gaChanges.map((change) => change.zoneId), [2]);
  const second = await executeSelectionCommit(retry, owner.ops);
  assert.deepEqual(second, { status: "confirmed" });
  assert.deepEqual(owner.state.calls, ["add:1:2", "add:2:3", "add:2:3"]);
  assert.equal(cartLinesByZone(owner.state.published, MATCH).get(1).quantity, 2, "A was not duplicated");
});

test("unknown outcome (applied but unpublished) is reconciled from the owner before any retry", async () => {
  const owner = fakeOwner();
  owner.state.script = ["unpublished"];
  const drafts = new Map([[1, 2]]);
  const outcome = await executeSelectionCommit(planFrom(owner, drafts), owner.ops);
  assert.equal(commitEffects(outcome, null).needsReconcile, true);

  // Without reconciling, the stale published view would re-add zone 1 and the additive backend merge would make it 4.
  assert.equal(planFrom(owner, drafts).gaChanges.length, 1);
  // Reconcile = re-read the owner's cart (here: publish the backend state); then nothing is left to send.
  owner.state.published = owner.state.backend.get(owner.state.sessionId).map((line) => ({ ...line }));
  assert.equal(planFrom(owner, drafts).gaChanges.length, 0);
});

test("timeouts, network failures and server errors require a reconcile; definite rejections do not", () => {
  const failed = { status: "failed", completedSteps: 0, error: new Error("x") };
  for (const kind of ["offline", "timeout", "generic", "maintenance"]) {
    assert.equal(commitEffects(failed, kind).needsReconcile, true, kind);
  }
  for (const kind of ["unavailable", "rejected", "expired", "session"]) {
    assert.equal(commitEffects(failed, kind).needsReconcile, false, kind);
  }
});

test("GA zero-removal and set semantics are verified against the published cart", () => {
  const plan = {
    matchId: MATCH,
    gaChanges: [
      { zoneId: 1, action: "remove", from: 2, to: 0, lockKey: "A" },
      { zoneId: 2, action: "update", from: 1, to: 3, lockKey: "B" },
    ],
    seats: null,
  };
  const line = (zone, quantity) => ({ lock_key: `L${zone}`, match_id: MATCH, stadium_zone_id: String(zone), type: "zone", quantity });
  assert.equal(cartReflectsPlan(plan, [line(2, 3)]), true);
  assert.equal(cartReflectsPlan(plan, [line(1, 2), line(2, 3)]), false, "removed line still present");
  assert.equal(cartReflectsPlan(plan, [line(2, 4)]), false, "additive merge instead of set");
  assert.equal(cartReflectsPlan({ ...plan, matchId: "8" }, [line(2, 3)]), false, "another match's line never counts");
});

/* ------------------------------ seat drafts ------------------------------ */

const seat = (id, status = "available") => ({ id, row: "A", number: String(id), status });

test("seat drafts are confirmable only against the current snapshot", () => {
  const none = new Set();
  const ok = actionableSeatDraft({ draftIds: [11, 12], currentSeats: [seat(11), seat(12)], cartSeatIds: none });
  assert.deepEqual(ok.actionableIds, [11, 12]);
  assert.equal(ok.awaitingSnapshot, false);

  const unavailable = actionableSeatDraft({ draftIds: [11, 12], currentSeats: [seat(11), seat(12, "sold")], cartSeatIds: none });
  assert.deepEqual(unavailable.actionableIds, [11]);
  assert.deepEqual(unavailable.droppedIds, [12]);

  const vanished = actionableSeatDraft({ draftIds: [11, 12], currentSeats: [seat(11)], cartSeatIds: none });
  assert.deepEqual(vanished.actionableIds, [11]);
  assert.deepEqual(vanished.droppedIds, [12]);

  const cartOwned = actionableSeatDraft({ draftIds: [11, 12], currentSeats: [seat(11), seat(12)], cartSeatIds: new Set([12]) });
  assert.deepEqual(cartOwned.actionableIds, [11]);
  assert.deepEqual(cartOwned.droppedIds, [], "a seat that reached the cart is excluded, not reported as lost");
});

test("no current snapshot (loading, failed, other identity) means nothing is confirmable", () => {
  const pending = actionableSeatDraft({ draftIds: [11], currentSeats: null, cartSeatIds: new Set() });
  assert.deepEqual(pending.actionableIds, []);
  assert.equal(pending.awaitingSnapshot, true);
  assert.deepEqual(selectionPreflight([], pending), { canConfirm: false, reason: "seatsPending" });
  // A draft from another zone identity is already emptied upstream (getEffectiveSelectedSeats): nothing to confirm.
  const otherZone = actionableSeatDraft({ draftIds: [], currentSeats: [seat(11)], cartSeatIds: new Set() });
  assert.deepEqual(selectionPreflight([], otherZone), { canConfirm: false, reason: "nothing" });
});

test("mixed GA + unvalidated seats: preflight blocks before the first cart mutation", async () => {
  const owner = fakeOwner();
  const draft = actionableSeatDraft({ draftIds: [11], currentSeats: null, cartSeatIds: new Set() });
  const plan = planFrom(owner, new Map([[1, 2]]));
  const preflight = selectionPreflight(plan.gaChanges, draft);
  assert.equal(preflight.canConfirm, false);
  // The screen returns before executeSelectionCommit when preflight fails, so the owner sees no call.
  assert.deepEqual(owner.state.calls, []);

  // A refreshed, valid snapshot makes the same selection confirmable again.
  const refreshed = actionableSeatDraft({ draftIds: [11], currentSeats: [seat(11)], cartSeatIds: new Set() });
  assert.deepEqual(selectionPreflight(plan.gaChanges, refreshed), { canConfirm: true });
  const outcome = await executeSelectionCommit({ ...plan, seats: { zoneId: 5, seatIds: refreshed.actionableIds } }, owner.ops);
  assert.deepEqual(outcome, { status: "confirmed" });
  assert.deepEqual(owner.state.calls, ["add:1:2", "seats:5:11"]);
});

test("stale seats never reach the payload", async () => {
  const owner = fakeOwner();
  const draft = actionableSeatDraft({ draftIds: [11, 12], currentSeats: [seat(11), seat(12, "locked")], cartSeatIds: new Set() });
  await executeSelectionCommit({ matchId: MATCH, gaChanges: [], seats: { zoneId: 5, seatIds: draft.actionableIds } }, owner.ops);
  assert.deepEqual(owner.state.calls, ["seats:5:11"]);
});

/* ----------------------------- touch targets ----------------------------- */

test("seat targets grow to the nearest-neighbour pitch, never overlap, and reach 44px by zooming", () => {
  // createSeatLayout guarantees a >= 28px pitch at 100%.
  const grid = [];
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < 4; col += 1) grid.push({ px: 36 + col * 28, py: 50 + row * 28 });
  const at100 = seatTouchTarget(grid, 1, 18);
  assert.equal(at100.size, 28);
  assert.equal(at100.meetsRecommended, false);
  assert.equal(seatTouchTarget(grid, 1.5, 27).size, 42);
  const at200 = seatTouchTarget(grid, 2, 36);
  assert.equal(at200.size, 48);
  assert.equal(at200.meetsRecommended, true);
  assert.equal(seatTouchTarget([{ px: 36, py: 50 }], 1, 18).size, 48, "a lone seat gets the full target");

  // Non-overlap: for any two seats, centred squares of the target size are separated on some axis.
  const staggered = [{ px: 0, py: 0 }, { px: 30, py: 14 }, { px: 60, py: 0 }, { px: 14, py: 40 }];
  const { size } = seatTouchTarget(staggered, 1, 10);
  for (const a of staggered) for (const b of staggered) {
    if (a === b) continue;
    assert.ok(Math.abs(a.px - b.px) >= size || Math.abs(a.py - b.py) >= size, "targets overlap");
  }
  // Reading positions never changes them.
  assert.deepEqual(staggered[1], { px: 30, py: 14 });
});
