import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCartSessionIfCurrent,
  createCartSessionAuthority,
} from "./cartSessionAuthority.ts";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("current-session conditional clear removes persistence and resets normally", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("session-a");
  const events = [];
  let resets = 0;

  const cleared = await clearCartSessionIfCurrent({
    authority,
    expected,
    removePersistedSession: async () => {
      events.push("remove");
    },
    canCommit: () => true,
    resetDisplayState: () => {
      resets += 1;
    },
  });

  assert.deepEqual(events, ["remove"]);
  assert.equal(resets, 1);
  assert.equal(cleared?.sessionId, null);
  assert.equal(authority.isCurrent(cleared), true);
});

test("replacement before conditional clear prevents persisted and React clearing", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("session-a");
  const replacement = authority.replace("session-b");
  let removed = false;
  let resets = 0;

  const cleared = await clearCartSessionIfCurrent({
    authority,
    expected,
    removePersistedSession: async () => {
      removed = true;
    },
    canCommit: () => true,
    resetDisplayState: () => {
      resets += 1;
    },
  });

  assert.equal(cleared, null);
  assert.equal(removed, false);
  assert.equal(resets, 0);
  assert.equal(authority.isCurrent(replacement), true);
});

test("replacement during persisted removal survives in persistence and React state", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("session-a");
  const removal = deferred();
  const events = [];
  let resets = 0;

  const clearing = clearCartSessionIfCurrent({
    authority,
    expected,
    removePersistedSession: async () => {
      events.push("remove:start");
      await removal.promise;
      events.push("remove:end");
    },
    canCommit: () => true,
    resetDisplayState: () => {
      resets += 1;
    },
  });

  await Promise.resolve();
  const replacement = authority.replace("session-b");
  const persistReplacement = authority.enqueuePersistence(async () => {
    events.push("set:session-b");
  });

  removal.resolve();
  const cleared = await clearing;
  await persistReplacement;

  assert.equal(cleared, null);
  assert.equal(resets, 0);
  assert.deepEqual(events, [
    "remove:start",
    "remove:end",
    "set:session-b",
  ]);
  assert.equal(authority.isCurrent(replacement), true);
  assert.equal(authority.currentSessionId(), "session-b");
});

test("null or expired transition during removal prevents stale reset", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("session-a");
  const removal = deferred();
  let resets = 0;

  const clearing = clearCartSessionIfCurrent({
    authority,
    expected,
    removePersistedSession: () => removal.promise,
    canCommit: () => true,
    resetDisplayState: () => {
      resets += 1;
    },
  });

  await Promise.resolve();
  const expired = authority.replace(null);
  removal.resolve();

  assert.equal(await clearing, null);
  assert.equal(resets, 0);
  assert.equal(authority.isCurrent(expired), true);
  assert.equal(authority.currentSessionId(), null);
});