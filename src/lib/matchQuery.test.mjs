import assert from "node:assert/strict";
import test from "node:test";
import { applyQueryFailure, applyQuerySuccess, emptyMatchQuerySnapshot, matchQueryView } from "./matchQuery.ts";
import { createRequestAuthority, createRequestIdentity } from "./requestAuthority.ts";

// Deterministic model of useScheduledMatches: the same request authority and
// snapshot functions the hook uses, driven step by step.
const identity = (filters) => createRequestIdentity([filters.team, filters.stadium, filters.date]);
const A = identity({});
const B = identity({ team: "mabarrah" });

function createOwner() {
  const authority = createRequestAuthority();
  authority.mount();
  let snapshot = emptyMatchQuerySnapshot();
  return {
    begin: (id) => ({ ticket: authority.begin(id), id }),
    /** Synchronous invalidation called before the filter state changes. */
    invalidate: (id) => authority.invalidate(id),
    succeed: (request, items) => {
      if (!authority.isCurrent(request.ticket)) return false;
      snapshot = applyQuerySuccess(request.id, items);
      return true;
    },
    fail: (request, message) => {
      if (!authority.isCurrent(request.ticket)) return false;
      snapshot = applyQueryFailure(snapshot, request.id, message);
      return true;
    },
    view: (selected) => matchQueryView(snapshot, selected),
  };
}

test("a late response for old filters cannot publish under the new selection", () => {
  const owner = createOwner();
  const requestA = owner.begin(A);   // request A starts
  owner.invalidate(B);               // user switches to B (synchronous, before state changes)
  const requestB = owner.begin(B);

  assert.equal(owner.succeed(requestA, ["a1", "a2"]), false, "A resolves after the switch and is dropped");
  assert.deepEqual(owner.view(B).items, []);

  assert.equal(owner.succeed(requestB, ["b1"]), true, "B publishes normally");
  assert.deepEqual(owner.view(B).items, ["b1"]);
});

test("even an already-resolved A result is never shown under B", () => {
  const owner = createOwner();
  owner.succeed(owner.begin(A), ["a1"]);
  owner.invalidate(B);
  owner.begin(B);
  const view = owner.view(B);
  assert.deepEqual(view.items, []);
  assert.equal(view.hasItemsForSelection, false, "the screen treats B as still loading");
});

test("successful filters A show results A", () => {
  const owner = createOwner();
  owner.succeed(owner.begin(A), ["a1", "a2"]);
  assert.deepEqual(owner.view(A), { items: ["a1", "a2"], hasItemsForSelection: true, error: null });
});

test("a failed refresh of the same filters keeps results A and reports the error", () => {
  const owner = createOwner();
  owner.succeed(owner.begin(A), ["a1"]);
  owner.fail(owner.begin(A), "offline");
  assert.deepEqual(owner.view(A), { items: ["a1"], hasItemsForSelection: true, error: "offline" });
});

test("switching A → B succeeds with results B", () => {
  const owner = createOwner();
  owner.succeed(owner.begin(A), ["a1"]);
  owner.invalidate(B);
  owner.succeed(owner.begin(B), ["b1"]);
  assert.deepEqual(owner.view(B).items, ["b1"]);
});

test("switching A → B that fails does NOT present results A as B", () => {
  const owner = createOwner();
  owner.succeed(owner.begin(A), ["a1"]);
  owner.invalidate(B);
  owner.fail(owner.begin(B), "offline");
  const view = owner.view(B);
  assert.deepEqual(view.items, []);
  assert.equal(view.error, "offline");
  // A's data is retained internally and becomes visible again only for A.
  assert.deepEqual(owner.view(A).items, ["a1"]);
});

test("retrying B after a failure can succeed", () => {
  const owner = createOwner();
  owner.succeed(owner.begin(A), ["a1"]);
  owner.invalidate(B);
  owner.fail(owner.begin(B), "offline");
  owner.succeed(owner.begin(B), ["b1", "b2"]);
  assert.deepEqual(owner.view(B), { items: ["b1", "b2"], hasItemsForSelection: true, error: null });
});

test("an error for one selection is never shown under another", () => {
  const owner = createOwner();
  owner.fail(owner.begin(A), "offline");
  owner.invalidate(B);
  owner.begin(B);
  assert.equal(owner.view(B).error, null);
});
