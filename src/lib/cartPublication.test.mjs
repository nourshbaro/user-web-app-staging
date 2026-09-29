import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { confirmedPublication, unconfirmedPublication } from "./cartPublication.ts";

const cart = await readFile(new URL("../context/CartContext.tsx", import.meta.url), "utf8");

function section(start, end) {
  const from = cart.indexOf(start);
  const to = cart.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section ${start} not found`);
  return cart.slice(from, to);
}

test("publication results carry the published snapshot or an unconfirmed reason", () => {
  assert.deepEqual(confirmedPublication("S", [1]), { confirmed: true, snapshot: { sessionId: "S", items: [1] } });
  assert.deepEqual(unconfirmedPublication("refresh-failed"), { confirmed: false, reason: "refresh-failed" });
});

test("add and update confirm only when the session-guarded publication actually published", () => {
  const add = section("const addItem = useCallback(", "const removeItem = useCallback(");
  const update = section("const updateItem = useCallback(", "const value = useMemo(");
  for (const [name, body] of [["addItem", add], ["updateItem", update]]) {
    const published = body.match(/const published = await publishCartResponseIfCurrent\(/g) ?? [];
    const confirmed = body.match(/return published\s*\? confirmedPublication\(response\.checkout_session_id, getCartItems\(response\.cart\)\)\s*: unconfirmedPublication\("session-changed"\);/g) ?? [];
    assert.ok(published.length >= 1, name);
    assert.equal(confirmed.length, published.length, `${name}: every publication maps to its result`);
    assert.doesNotMatch(body, /isCurrent\(expected\)\s*\) return;/, `${name}: a stale-session guard never resolves as unknown`);
  }
  assert.match(add, /router\.push\("\/auth"\); return Promise\.resolve\(unconfirmedPublication\("unauthenticated"\)\)/);
  assert.match(add, /if \(!publicationOwner\) return unconfirmedPublication\("session-changed"\);/);
});

test("a delete is confirmed only by the refresh that publishes the resulting cart", () => {
  const remove = section("const removeItem = useCallback(", "const removeItems = useCallback(");
  assert.match(remove, /await cartService\.remove\(lockKey\);/);
  assert.match(remove, /return refreshCartForSession\(expected\);/);
  assert.doesNotMatch(remove, /[^n]confirmedPublication\(/, "remove never confirms on its own");

  const refresh = section("const refreshCartForSession = useCallback(", "const refreshCart = useCallback(");
  assert.match(refresh, /setCartRefreshError\([\s\S]*?\);\s*return unconfirmedPublication\("refresh-failed"\);/);
  assert.match(refresh, /await clearCartIfSession\(expected\);\s*return unconfirmedPublication\("session-ended"\);/);
  assert.match(refresh, /const cleared = await clearCartIfSession\(expected\);\s*return cleared\s*\? confirmedPublication<CartItem>\(null, \[\]\)/);
  assert.match(refresh, /applyCart\(response\);\s*applied = true;/);
  assert.match(refresh, /return applied\s*\? confirmedPublication\(expected\.sessionId, nextItems\)/);
});

test("the change is a return contract only: queue and guards are untouched", () => {
  assert.equal((cart.match(/operationQueue\.run\(/g) ?? []).length, 5);
  assert.match(cart, /addMutationGuardRef\.current\.run\(/);
  // Phase 4 corrections: grouped removal reports what it actually did.
  assert.match(cart, /removeItems: \(lockKeys: string\[\]\) => Promise<CartRemovalResult>;/);
  assert.match(cart, /refreshCart: \(\) => Promise<CartPublication>;/);
});

test("grouped removal proves its own deletes and never reads expiry as removal", () => {
  const removeItems = section("const removeItems = useCallback(", "const updateItem = useCallback(");
  // The sequence (behaviour-tested in cartReconciliation.test.mjs) runs inside the owner's queue,
  // bound to the session captured when the removal was requested.
  assert.match(removeItems, /return operationQueue\.run\(\(\) => runGroupedRemoval\(\{/);
  assert.match(removeItems, /isSessionCurrent: \(\) => mountedRef\.current && sessionAuthorityRef\.current\.isCurrent\(expected\),/);
  assert.match(removeItems, /refresh: \(\) => refreshCartForSession\(expected\),/);
  assert.match(removeItems, /if \(isCartReconciliationRequired\(\)\) \{\s*return Promise\.resolve\(\{ status: "notPerformed", reason: "reconciliation-required" \}\);/);
  assert.doesNotMatch(removeItems, /Promise\.all\(/);
});

test("the shared gate lives in CartContext: mutations refuse while it is active, only an explicit read releases it", () => {
  for (const name of ["addItem", "removeItem", "updateItem"]) {
    const start = cart.indexOf(`const ${name} = useCallback(`);
    const body = cart.slice(start, cart.indexOf("}, [", start));
    assert.match(body, /if \(isCartReconciliationRequired\(\)\) return (Promise\.resolve\()?unconfirmedPublication\("reconciliation-required"\)/, name);
    assert.match(body, /trackOutcome\(expected\.sessionId,/, `${name} raises the gate on unknown outcomes`);
  }
  const refreshCart = section("const refreshCart = useCallback(", "useEffect(");
  assert.match(refreshCart, /releaseAfterRead\(reconciliationRef\.current, \{\s*confirmed: result\.confirmed,\s*readSessionId: expected\.sessionId,/);
  // The internal post-mutation refresh never releases it.
  const refreshForSession = section("const refreshCartForSession = useCallback(", "const refreshCart = useCallback(");
  assert.doesNotMatch(refreshForSession, /releaseAfterRead|setReconciliation/);
  assert.match(cart, /reconciliationRef\.current = dropIfSessionEnded\(reconciliationRef\.current, null\);/);
});
