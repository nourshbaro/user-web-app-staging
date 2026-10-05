import assert from "node:assert/strict";
import test from "node:test";
import { createQueryCache } from "./queryCache.ts";

const POLICY = { freshMs: 1000, maxStaleMs: 5000 };

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function harness(scope = () => 0) {
  let time = 0;
  const cache = createQueryCache({ now: () => time, scope });
  let calls = 0;
  const fetcher = (value) => () => {
    calls += 1;
    return Promise.resolve(value);
  };
  return {
    cache,
    fetcher,
    calls: () => calls,
    advance: (ms) => {
      time += ms;
    },
  };
}

test("a fresh entry is served without a second request", async () => {
  const h = harness();
  assert.equal(await h.cache.read("k", POLICY, h.fetcher("a")), "a");
  h.advance(999);
  assert.equal(await h.cache.read("k", POLICY, h.fetcher("b")), "a");
  assert.equal(h.calls(), 1);
});

test("a stale entry is re-read, and peek shows it only within maxStaleMs", async () => {
  const h = harness();
  await h.cache.read("k", POLICY, h.fetcher("a"));
  h.advance(1001);
  assert.deepEqual(h.cache.peek("k", POLICY), { value: "a", fetchedAt: 0 }, "stale but showable");
  assert.equal(await h.cache.read("k", POLICY, h.fetcher("b")), "b");
  assert.equal(h.calls(), 2);
  h.advance(5001);
  assert.equal(h.cache.peek("k", POLICY), null, "too old to show");
});

test("force always requests", async () => {
  const h = harness();
  await h.cache.read("k", POLICY, h.fetcher("a"));
  assert.equal(await h.cache.read("k", POLICY, h.fetcher("b"), { force: true }), "b");
  assert.equal(h.calls(), 2);
});

test("identical concurrent reads share one request", async () => {
  const h = harness();
  const pending = deferred();
  let calls = 0;
  const fetcher = () => {
    calls += 1;
    return pending.promise;
  };
  const first = h.cache.read("k", POLICY, fetcher);
  const second = h.cache.read("k", POLICY, fetcher);
  pending.resolve("shared");
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  assert.equal(calls, 1);
});

test("different parameters never collide", async () => {
  const h = harness();
  await h.cache.read("/matches/scheduled?status=live", POLICY, h.fetcher("live"));
  await h.cache.read("/matches/scheduled?status=completed", POLICY, h.fetcher("completed"));
  assert.equal(await h.cache.read("/matches/scheduled?status=live", POLICY, h.fetcher("x")), "live");
  assert.equal(await h.cache.read("/matches/scheduled?status=completed", POLICY, h.fetcher("x")), "completed");
  assert.equal(h.calls(), 2);
});

test("failures are not cached as data, and a later read fetches again", async () => {
  const h = harness();
  await assert.rejects(() => h.cache.read("k", POLICY, () => Promise.reject(new Error("offline"))), /offline/);
  assert.equal(h.cache.peek("k", POLICY), null);
  assert.equal(await h.cache.read("k", POLICY, h.fetcher("ok")), "ok");
});

test("a failed request leaves the previous good entry in place", async () => {
  const h = harness();
  await h.cache.read("k", POLICY, h.fetcher("good"));
  await assert.rejects(() => h.cache.read("k", POLICY, () => Promise.reject(new Error("500")), { force: true }));
  assert.equal(h.cache.peek("k", POLICY).value, "good");
});

test("an older, slower response cannot overwrite a newer one", async () => {
  const h = harness();
  const slow = deferred();
  const fast = deferred();
  const older = h.cache.read("k", POLICY, () => slow.promise, { force: true });
  const newer = h.cache.read("k", POLICY, () => fast.promise, { force: true });
  fast.resolve("new");
  await newer;
  slow.resolve("old");
  assert.equal(await older, "new", "the older request's caller gets the authoritative answer, not its obsolete one");
  assert.equal(h.cache.peek("k", POLICY).value, "new");
});

test("a superseded response that settles before the newer one waits for it", async () => {
  const h = harness();
  const slow = deferred();
  const fast = deferred();
  const older = h.cache.read("k", POLICY, () => slow.promise, { force: true });
  const newer = h.cache.read("k", POLICY, () => fast.promise, { force: true });
  slow.resolve("old");
  fast.resolve("new");
  assert.deepEqual(await Promise.all([older, newer]), ["new", "new"]);
});

test("a superseded failure defers to the newer answer instead of surfacing an error", async () => {
  const h = harness();
  const slow = deferred();
  const older = h.cache.read("k", POLICY, () => slow.promise, { force: true });
  await h.cache.read("k", POLICY, h.fetcher("new"), { force: true });
  slow.reject(new Error("old request failed"));
  assert.equal(await older, "new");
});

test("invalidation makes the next read fetch, and an in-flight response it voided is re-read", async () => {
  const h = harness();
  await h.cache.read("k", POLICY, h.fetcher("a"));
  h.cache.invalidate("k");
  assert.equal(h.cache.peek("k", POLICY), null);
  assert.equal(await h.cache.read("k", POLICY, h.fetcher("b")), "b");

  const pending = deferred();
  let calls = 0;
  const fetcher = () => {
    calls += 1;
    return calls === 1 ? pending.promise : Promise.resolve("current");
  };
  const inFlight = h.cache.read("j", POLICY, fetcher);
  h.cache.invalidate("j");
  pending.resolve("from before the invalidation");
  assert.equal(await inFlight, "current", "the obsolete answer never reaches the caller");
  assert.equal(calls, 2);
  assert.equal(h.cache.peek("j", POLICY).value, "current");
});

test("onAccept runs once for an accepted response and never for a superseded one", async () => {
  const h = harness();
  const accepted = [];
  const onAccept = (value) => accepted.push(value);
  const slow = deferred();
  const fast = deferred();
  const older = h.cache.read("k", POLICY, () => slow.promise, { force: true, onAccept });
  const newer = h.cache.read("k", POLICY, () => fast.promise, { force: true, onAccept });
  fast.resolve("B");
  await newer;
  slow.resolve("A");
  await older;
  assert.deepEqual(accepted, ["B"]);
  await h.cache.read("k", POLICY, h.fetcher("x"), { onAccept });
  assert.deepEqual(accepted, ["B"], "a cache hit is not a new acceptance");
});

test("onAccept does not run for a response voided by invalidation or failure", async () => {
  const h = harness();
  const accepted = [];
  const pending = deferred();
  let calls = 0;
  const read = h.cache.read("k", POLICY, () => {
    calls += 1;
    return calls === 1 ? pending.promise : Promise.resolve("fresh");
  }, { onAccept: (value) => accepted.push(value) });
  h.cache.invalidate("k");
  pending.resolve("stale");
  await read;
  assert.deepEqual(accepted, ["fresh"]);
  await assert.rejects(() => h.cache.read("f", POLICY, () => Promise.reject(new Error("x")), { onAccept: (value) => accepted.push(value) }));
  assert.deepEqual(accepted, ["fresh"]);
});

test("prefix and predicate invalidation only touch matching keys", async () => {
  const h = harness();
  await h.cache.read("/portal/a", POLICY, h.fetcher(1));
  await h.cache.read("/portal/b", POLICY, h.fetcher(2));
  await h.cache.read("/public", POLICY, h.fetcher(3));
  h.cache.invalidate("/portal/");
  assert.equal(h.cache.peek("/portal/a", POLICY), null);
  assert.equal(h.cache.peek("/portal/b", POLICY), null);
  assert.equal(h.cache.peek("/public", POLICY).value, 3);
  h.cache.invalidate((key) => key === "/public");
  assert.equal(h.cache.peek("/public", POLICY), null);
});

test("a scope change (identity switch) drops entries and discards responses from the old scope", async () => {
  let generation = 0;
  const h = harness(() => generation);
  await h.cache.read("tickets", POLICY, h.fetcher("user A"));
  const pending = deferred();
  const lateA = h.cache.read("other", POLICY, () => pending.promise);

  generation += 1; // logout / login as user B
  assert.equal(h.cache.peek("tickets", POLICY), null, "user A's entry is gone");
  pending.resolve("user A late");
  await lateA;
  assert.equal(h.cache.peek("other", POLICY), null, "user A's late response is not cached for user B");
  assert.equal(await h.cache.read("tickets", POLICY, h.fetcher("user B")), "user B");
});

test("a scope change also stops sharing an in-flight read from the old scope", async () => {
  let generation = 0;
  const h = harness(() => generation);
  const pendingA = deferred();
  void h.cache.read("k", POLICY, () => pendingA.promise);
  generation += 1;
  let calls = 0;
  const forB = h.cache.read("k", POLICY, () => {
    calls += 1;
    return Promise.resolve("B");
  });
  assert.equal(await forB, "B");
  assert.equal(calls, 1, "user B made its own request");
  pendingA.resolve("A");
});

test("clear() drops everything", async () => {
  const h = harness();
  await h.cache.read("k", POLICY, h.fetcher("a"));
  h.cache.clear();
  assert.equal(h.cache.peek("k", POLICY), null);
});
