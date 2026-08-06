import assert from "node:assert/strict";
import test from "node:test";
import {
  UserScopedCache,
  clearUserScopedCaches,
  getUserScopedCacheGeneration,
  onUserScopedCacheInvalidated,
} from "./userScopedCache.ts";

test("same user can reuse its cached profile data", () => {
  const cache = new UserScopedCache();
  cache.set("id:1", { orders: ["A-order"] });

  assert.deepEqual(cache.get("id:1"), { orders: ["A-order"] });
});

test("a different user cannot read the previous user's cache", () => {
  const cache = new UserScopedCache();
  cache.set("id:1", { tickets: ["A-ticket"] });

  assert.equal(cache.get("id:2"), null);
});

test("guest state cannot set or consume authenticated profile data", () => {
  const cache = new UserScopedCache();

  assert.equal(cache.set(null, { orders: ["guest-order"] }), false);
  assert.equal(cache.get(null), null);
});

test("central session invalidation clears profile data and advances request generation", () => {
  const cache = new UserScopedCache();
  const before = getUserScopedCacheGeneration();
  cache.set("id:1", { orders: ["A-order"] });

  clearUserScopedCaches();

  assert.equal(cache.get("id:1"), null);
  assert.equal(getUserScopedCacheGeneration(), before + 1);
});

test("manual logout and direct account replacement notify rendered-state owners", () => {
  let invalidations = 0;
  const unsubscribe = onUserScopedCacheInvalidated(() => {
    invalidations += 1;
  });

  clearUserScopedCaches();
  clearUserScopedCaches();
  unsubscribe();

  assert.equal(invalidations, 2);
});

test("an invalidated User A request generation cannot be current for User B", () => {
  const userARequestGeneration = getUserScopedCacheGeneration();

  clearUserScopedCaches();

  assert.notEqual(userARequestGeneration, getUserScopedCacheGeneration());
});
