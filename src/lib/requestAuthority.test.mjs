import assert from "node:assert/strict";
import test from "node:test";
import { createRequestAuthority, createRequestIdentity } from "./requestAuthority.ts";

function createPublicationHarness(initialIdentity) {
  const authority = createRequestAuthority();
  authority.mount();
  let activeIdentity = initialIdentity;
  const state = { data: null, error: null, loading: false, toasts: [] };

  return {
    state,
    start(identity) {
      activeIdentity = identity;
      state.loading = true;
      const ticket = authority.begin(identity);
      return {
        succeed(data) {
          if (!authority.isCurrent(ticket, activeIdentity)) return;
          state.data = data;
          state.error = null;
          state.loading = false;
        },
        fail(message) {
          if (!authority.isCurrent(ticket, activeIdentity)) return;
          state.error = message;
          state.toasts.push(message);
          state.loading = false;
        },
        finish() {
          if (!authority.isCurrent(ticket, activeIdentity)) return;
          state.loading = false;
        },
      };
    },
    invalidate(identity) {
      activeIdentity = identity;
      authority.invalidate();
    },
    unmount() {
      authority.unmount();
    },
  };
}

const filter = (team, stadium = null, date = null) => createRequestIdentity([team, stadium, date]);
const seats = (matchId, zoneId, cartSignature = "") => createRequestIdentity([matchId, zoneId, cartSignature]);

test("newer filter success remains authoritative after older success", () => {
  const harness = createPublicationHarness(filter("a"));
  const requestA = harness.start(filter("a"));
  const requestB = harness.start(filter("b"));
  requestB.succeed("B");
  requestA.succeed("A");
  assert.equal(harness.state.data, "B");
});

test("older filter failure cannot publish an error or toast after newer success", () => {
  const harness = createPublicationHarness(filter("a"));
  const requestA = harness.start(filter("a"));
  const requestB = harness.start(filter("b"));
  requestB.succeed("B");
  requestA.fail("A failed");
  assert.deepEqual(harness.state, { data: "B", error: null, loading: false, toasts: [] });
});

test("older filter completion cannot stop a pending newer request", () => {
  const harness = createPublicationHarness(filter("a"));
  const requestA = harness.start(filter("a"));
  harness.start(filter("b"));
  requestA.finish();
  assert.equal(harness.state.loading, true);
});

test("three reversed filter completions leave the newest request authoritative", () => {
  const harness = createPublicationHarness(filter("a"));
  const requestA = harness.start(filter("a"));
  const requestB = harness.start(filter("b"));
  const requestC = harness.start(filter("c"));
  requestC.succeed("C");
  requestB.succeed("B");
  requestA.succeed("A");
  assert.equal(harness.state.data, "C");
});

test("newest same-filter request wins", () => {
  const identity = filter("a");
  const harness = createPublicationHarness(identity);
  const initialLoad = harness.start(identity);
  const pullToRefresh = harness.start(identity);
  pullToRefresh.succeed("fresh");
  initialLoad.succeed("old");
  assert.equal(harness.state.data, "fresh");
});

test("newer match success remains authoritative after older success", () => {
  const harness = createPublicationHarness("match-a");
  const matchA = harness.start("match-a");
  const matchB = harness.start("match-b");

  matchB.succeed("B");
  matchA.succeed("A");

  assert.deepEqual(harness.state, { data: "B", error: null, loading: false, toasts: [] });
});

test("stale match error and finalization cannot affect the newer match", () => {
  const harness = createPublicationHarness("match-a");
  const matchA = harness.start("match-a");
  const matchB = harness.start("match-b");

  matchB.succeed("B");
  matchA.fail("A failed");
  matchA.finish();

  assert.deepEqual(harness.state, { data: "B", error: null, loading: false, toasts: [] });
});

test("same-match newer refresh supersedes the older detail request", () => {
  const harness = createPublicationHarness("match-a");
  const initial = harness.start("match-a");
  const refresh = harness.start("match-a");

  refresh.succeed("fresh A");
  initial.succeed("old A");

  assert.equal(harness.state.data, "fresh A");
});

test("unmount invalidates the current match request", () => {
  const harness = createPublicationHarness("match-a");
  const request = harness.start("match-a");

  harness.unmount();
  request.succeed("A");
  request.fail("A failed");
  request.finish();

  assert.deepEqual(harness.state, { data: null, error: null, loading: true, toasts: [] });
});

test("unmount invalidates pending filter success", () => {
  const harness = createPublicationHarness(filter("a"));
  const request = harness.start(filter("a"));
  harness.unmount();
  request.succeed("A");
  assert.equal(harness.state.data, null);
});

test("unmount invalidates pending filter failure and toast", () => {
  const harness = createPublicationHarness(filter("a"));
  const request = harness.start(filter("a"));
  harness.unmount();
  request.fail("failed");
  assert.deepEqual(harness.state.toasts, []);
});

test("latest filter failure retains current error and toast behavior", () => {
  const harness = createPublicationHarness(filter("a"));
  const request = harness.start(filter("a"));
  request.fail("failed");
  assert.equal(harness.state.error, "failed");
  assert.deepEqual(harness.state.toasts, ["failed"]);
});

test("newer zone success remains authoritative after older success", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const zoneA = harness.start(seats(1, 10));
  const zoneB = harness.start(seats(1, 20));
  zoneB.succeed(["B-seat"]);
  zoneA.succeed(["A-seat"]);
  assert.deepEqual(harness.state.data, ["B-seat"]);
});

test("older zone failure cannot publish a toast after newer success", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const zoneA = harness.start(seats(1, 10));
  const zoneB = harness.start(seats(1, 20));
  zoneB.succeed(["B-seat"]);
  zoneA.fail("A failed");
  assert.deepEqual(harness.state.toasts, []);
});

test("clearing a zone invalidates its pending response", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const zoneA = harness.start(seats(1, 10));
  harness.invalidate(seats(1, null));
  zoneA.succeed(["A-seat"]);
  assert.equal(harness.state.data, null);
});

test("changing match ID invalidates the previous match response", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const matchA = harness.start(seats(1, 10));
  harness.invalidate(seats(2, null));
  matchA.succeed(["A-seat"]);
  assert.equal(harness.state.data, null);
});

test("three reversed zone completions leave the newest zone authoritative", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const zoneA = harness.start(seats(1, 10));
  const zoneB = harness.start(seats(1, 20));
  const zoneC = harness.start(seats(1, 30));
  zoneC.succeed(["C-seat"]);
  zoneB.succeed(["B-seat"]);
  zoneA.succeed(["A-seat"]);
  assert.deepEqual(harness.state.data, ["C-seat"]);
});

test("older zone completion cannot stop a pending newer request", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const zoneA = harness.start(seats(1, 10));
  harness.start(seats(1, 20));
  zoneA.finish();
  assert.equal(harness.state.loading, true);
});

test("cart-triggered same-zone reload makes the newest snapshot authoritative", () => {
  const harness = createPublicationHarness(seats(1, 10, "cart-a"));
  const older = harness.start(seats(1, 10, "cart-a"));
  const newer = harness.start(seats(1, 10, "cart-b"));
  newer.succeed(["new-seat"]);
  older.succeed(["old-seat"]);
  assert.deepEqual(harness.state.data, ["new-seat"]);
});

test("unmount invalidates pending zone success and failure", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const success = harness.start(seats(1, 10));
  const failure = harness.start(seats(1, 20));
  harness.unmount();
  success.succeed(["seat"]);
  failure.fail("failed");
  assert.equal(harness.state.data, null);
  assert.deepEqual(harness.state.toasts, []);
});

test("latest zone failure retains current toast behavior", () => {
  const harness = createPublicationHarness(seats(1, 10));
  const request = harness.start(seats(1, 10));
  request.fail("failed");
  assert.deepEqual(harness.state.toasts, ["failed"]);
});

test("request identity includes every scalar input in order", () => {
  assert.notEqual(filter("team-a", "stadium-a", "2026-08-06"), filter("team-a", "stadium-b", "2026-08-06"));
  assert.notEqual(seats(1, 10, "cart-a"), seats(1, 10, "cart-b"));
});
