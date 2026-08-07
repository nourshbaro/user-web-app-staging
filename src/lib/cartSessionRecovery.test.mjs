import assert from "node:assert/strict";
import test from "node:test";
import { addWithSessionRecovery, createSingleFlight } from "./cartSessionRecovery.ts";
import { createCartRefreshGuard } from "./cartRefreshPolicy.ts";

const statusOf = (error) => typeof error?.status === "number" ? error.status : null;
const errorWithStatus = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test("no existing session sends one bootstrap request without a session", async () => {
  const calls = [];
  const response = await addWithSessionRecovery({
    payload: { match_id: 1, stadium_zone_id: 2, seat_ids: [3] },
    sessionId: null,
    add: async (payload) => {
      calls.push(payload);
      return { checkout_session_id: "new" };
    },
    getStatus: statusOf,
    invalidateRejectedSession: async () => assert.fail("must not invalidate"),
  });

  assert.equal(response.checkout_session_id, "new");
  assert.deepEqual(calls, [{ match_id: 1, stadium_zone_id: 2, seat_ids: [3] }]);
});

test("valid existing session sends one request with the existing ID", async () => {
  const calls = [];
  await addWithSessionRecovery({
    payload: { match_id: 1, stadium_zone_id: 2, quantity: 1 },
    sessionId: "session-a",
    add: async (payload) => {
      calls.push(payload);
      return { checkout_session_id: "session-a" };
    },
    getStatus: statusOf,
    invalidateRejectedSession: async () => assert.fail("must not invalidate"),
  });

  assert.deepEqual(calls, [{
    match_id: 1,
    stadium_zone_id: 2,
    quantity: 1,
    checkout_session_id: "session-a",
  }]);
});

test("existing session 404 invalidates once and retries once without the rejected ID", async () => {
  const calls = [];
  const invalidated = [];
  const response = await addWithSessionRecovery({
    payload: { match_id: 1, stadium_zone_id: 2, seat_ids: [3] },
    sessionId: "session-a",
    add: async (payload) => {
      calls.push(payload);
      if (calls.length === 1) throw errorWithStatus(404);
      return { checkout_session_id: "session-b" };
    },
    getStatus: statusOf,
    invalidateRejectedSession: async (sessionId) => invalidated.push(sessionId),
  });

  assert.equal(response.checkout_session_id, "session-b");
  assert.deepEqual(invalidated, ["session-a"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].checkout_session_id, "session-a");
  assert.equal("checkout_session_id" in calls[1], false);
});

test("bootstrap retry failure propagates and never performs a third request", async () => {
  const calls = [];
  const retryError = errorWithStatus(500);

  await assert.rejects(
    addWithSessionRecovery({
      payload: { match_id: 1, stadium_zone_id: 2, seat_ids: [3] },
      sessionId: "session-a",
      add: async (payload) => {
        calls.push(payload);
        if (calls.length === 1) throw errorWithStatus(404);
        throw retryError;
      },
      getStatus: statusOf,
      invalidateRejectedSession: async () => {},
    }),
    (error) => error === retryError,
  );
  assert.equal(calls.length, 2);
});

for (const status of [500, 401, 403]) {
  test(`existing session HTTP ${status} is retained and not retried`, async () => {
    const calls = [];
    let invalidated = false;
    const originalError = errorWithStatus(status);

    await assert.rejects(
      addWithSessionRecovery({
        payload: { match_id: 1, stadium_zone_id: 2, seat_ids: [3] },
        sessionId: "session-a",
        add: async (payload) => {
          calls.push(payload);
          throw originalError;
        },
        getStatus: statusOf,
        invalidateRejectedSession: async () => {
          invalidated = true;
        },
      }),
      (error) => error === originalError,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].checkout_session_id, "session-a");
    assert.equal(invalidated, false);
  });
}

for (const label of ["network", "timeout", "unknown"]) {
  test(`existing session ${label} failure is retained and not retried`, async () => {
    const calls = [];
    const originalError = new Error(label);

    await assert.rejects(
      addWithSessionRecovery({
        payload: { match_id: 1, stadium_zone_id: 2, seat_ids: [3] },
        sessionId: "session-a",
        add: async (payload) => {
          calls.push(payload);
          throw originalError;
        },
        getStatus: statusOf,
        invalidateRejectedSession: async () => assert.fail("must not invalidate"),
      }),
      (error) => error === originalError,
    );
    assert.equal(calls.length, 1);
  });
}

test("single-flight coalesces concurrent recovery operations", async () => {
  const guard = createSingleFlight();
  let operations = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const operation = async () => {
    operations += 1;
    await blocked;
    return "done";
  };

  const first = guard.run(operation);
  const second = guard.run(operation);
  assert.equal(first, second);
  assert.equal(operations, 1);
  release();
  assert.equal(await first, "done");
  assert.equal(await second, "done");
});

test("terminal mutation recovery makes an old session refresh non-authoritative", async () => {
  const refreshGuard = createCartRefreshGuard();
  const oldRefresh = refreshGuard.begin();

  const response = await addWithSessionRecovery({
    payload: { match_id: 1, stadium_zone_id: 2, seat_ids: [3] },
    sessionId: "session-a",
    add: async (payload) => {
      if (payload.checkout_session_id) throw errorWithStatus(404);
      return { checkout_session_id: "session-b" };
    },
    getStatus: statusOf,
    invalidateRejectedSession: async () => refreshGuard.invalidate(),
  });

  assert.equal(response.checkout_session_id, "session-b");
  assert.equal(refreshGuard.isCurrent(oldRefresh), false);
});
