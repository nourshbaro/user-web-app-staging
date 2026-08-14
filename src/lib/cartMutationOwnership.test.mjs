import assert from "node:assert/strict";
import test from "node:test";
import { createCartOperationQueue } from "./cartOperationQueue.ts";
import {
  createCartSessionAuthority,
  publishCartSessionIfCurrent,
} from "./cartSessionAuthority.ts";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function response(sessionId, value) {
  return { sessionId, value };
}

async function publishResponse({
  authority,
  expected,
  result,
  storage,
  display,
  gate,
}) {
  return publishCartSessionIfCurrent({
    authority,
    expected,
    persist: async () => {
      storage.current = result;
    },
    canPublish: () => gate.current,
    publish: () => {
      display.current = result;
    },
  });
}

test("current mutation session persists and publishes", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  const storage = { current: null };
  const display = { current: null };
  const gate = { current: true };
  const result = response("A", "current");

  assert.equal(await publishResponse({
    authority,
    expected,
    result,
    storage,
    display,
    gate,
  }), true);
  assert.equal(storage.current, result);
  assert.equal(display.current, result);
});

test("expiry blocks stale mutation persistence and React publication", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  authority.replace(null);
  const storage = { current: null };
  const display = { current: null };
  const gate = { current: true };

  assert.equal(await publishResponse({
    authority,
    expected,
    result: response("A", "stale"),
    storage,
    display,
    gate,
  }), false);
  assert.equal(storage.current, null);
  assert.equal(display.current, null);
});

test("replacement B blocks stale mutation A", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  authority.replace("B");
  const storage = { current: response("B", "replacement") };
  const display = { current: storage.current };
  const gate = { current: true };

  assert.equal(await publishResponse({
    authority,
    expected,
    result: response("A", "stale"),
    storage,
    display,
    gate,
  }), false);
  assert.equal(storage.current.sessionId, "B");
  assert.equal(display.current.sessionId, "B");
});

test("same literal session ID with newer generation blocks old mutation", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  const replacement = authority.replace("A");
  const storage = { current: null };
  const display = { current: null };
  const gate = { current: true };

  assert.equal(authority.isCurrent(expected), false);
  assert.equal(authority.isCurrent(replacement), true);
  assert.equal(await publishResponse({
    authority,
    expected,
    result: response("A", "old-generation"),
    storage,
    display,
    gate,
  }), false);
});

test("null bootstrap ticket is invalidated by another authority", async () => {
  const authority = createCartSessionAuthority();
  const bootstrap = authority.captureCurrent();
  assert.equal(bootstrap.sessionId, null);

  authority.replace("B");

  const storage = { current: response("B", "replacement") };
  const display = { current: storage.current };
  const gate = { current: true };

  assert.equal(await publishResponse({
    authority,
    expected: bootstrap,
    result: response("A", "late-bootstrap"),
    storage,
    display,
    gate,
  }), false);
  assert.equal(authority.currentSessionId(), "B");
  assert.equal(storage.current.sessionId, "B");
  assert.equal(display.current.sessionId, "B");
});

test("authority change while persistence waits blocks stale storage and apply", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  const blocker = deferred();
  const storage = { current: null };
  const display = { current: null };
  const gate = { current: true };

  const blockedOperation = authority.enqueuePersistence(() => blocker.promise);
  const publication = publishResponse({
    authority,
    expected,
    result: response("A", "stale"),
    storage,
    display,
    gate,
  });

  authority.replace("B");
  blocker.resolve();
  await blockedOperation;

  assert.equal(await publication, false);
  assert.equal(storage.current, null);
  assert.equal(display.current, null);
});

test("authority change during storage prevents stale React publication", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  const storageWrite = deferred();
  const display = { current: null };
  const gate = { current: true };
  let storageValue = null;

  const publication = publishCartSessionIfCurrent({
    authority,
    expected,
    persist: async () => {
      await storageWrite.promise;
      storageValue = response("A", "temporary");
    },
    canPublish: () => gate.current,
    publish: () => {
      display.current = response("A", "stale");
    },
  });

  await Promise.resolve();
  const replacement = authority.replace("B");
  const replacementPersistence = authority.enqueuePersistence(async () => {
    storageValue = response("B", "replacement");
  });

  storageWrite.resolve();

  assert.equal(await publication, false);
  await replacementPersistence;
  assert.equal(authority.isCurrent(replacement), true);
  assert.equal(storageValue.sessionId, "B");
  assert.equal(display.current, null);
});

test("stale remove completion cannot start refresh", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  let refreshes = 0;

  authority.replace(null);

  if (authority.isCurrent(expected)) refreshes += 1;

  assert.equal(refreshes, 0);
});

test("current remove completion still starts refresh", async () => {
  const authority = createCartSessionAuthority();
  const expected = authority.replace("A");
  let refreshes = 0;

  if (authority.isCurrent(expected)) refreshes += 1;

  assert.equal(refreshes, 1);
});

test("FIFO operation queue prevents reverse-order mutation publication", async () => {
  const events = [];
  const firstResponse = deferred();
  const queue = createCartOperationQueue(() => {});

  const first = queue.run(async () => {
    events.push("M1:start");
    await firstResponse.promise;
    events.push("M1:publish");
  });
  const second = queue.run(async () => {
    events.push("M2:start");
    events.push("M2:publish");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["M1:start"]);

  firstResponse.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(events, [
    "M1:start",
    "M1:publish",
    "M2:start",
    "M2:publish",
  ]);
});

test("loading remains active until all queued mutations finish", async () => {
  const loadingEvents = [];
  const firstResponse = deferred();
  const secondResponse = deferred();
  const queue = createCartOperationQueue((loading) => {
    loadingEvents.push(loading);
  });

  const first = queue.run(() => firstResponse.promise);
  const second = queue.run(() => secondResponse.promise);

  assert.deepEqual(loadingEvents, [true]);

  firstResponse.resolve();
  await first;
  assert.deepEqual(loadingEvents, [true]);

  secondResponse.resolve();
  await second;
  assert.deepEqual(loadingEvents, [true, false]);
});

test("untracked refresh shares ordering without changing mutation loading", async () => {
  const loadingEvents = [];
  const mutationResponse = deferred();
  const events = [];
  const queue = createCartOperationQueue((loading) => {
    loadingEvents.push(loading);
  });

  const mutation = queue.run(async () => {
    events.push("mutation:start");
    await mutationResponse.promise;
    events.push("mutation:end");
  });
  const refresh = queue.run(async () => {
    events.push("refresh");
  }, { trackLoading: false });

  await Promise.resolve();
  assert.deepEqual(events, ["mutation:start"]);
  assert.deepEqual(loadingEvents, [true]);

  mutationResponse.resolve();
  await Promise.all([mutation, refresh]);

  assert.deepEqual(events, [
    "mutation:start",
    "mutation:end",
    "refresh",
  ]);
  assert.deepEqual(loadingEvents, [true, false]);
});