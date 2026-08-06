import assert from "node:assert/strict";
import test from "node:test";
import { classifyCartRefreshFailure, createCartRefreshGuard } from "./cartRefreshPolicy.ts";

test("404 missing cart is terminal and clears the persisted session", () => {
  assert.deepEqual(classifyCartRefreshFailure(404), {
    kind: "terminal",
    shouldClearSession: true,
  });
});

for (const [name, status] of [
  ["network failure", null],
  ["timeout", null],
  ["HTTP 408", 408],
  ["HTTP 425", 425],
  ["HTTP 429", 429],
  ["HTTP 500", 500],
  ["HTTP 599", 599],
  ["unauthorized HTTP 401", 401],
  ["forbidden HTTP 403", 403],
  ["unknown HTTP error", 418],
]) {
  test(`${name} is transient and retains the persisted session`, () => {
    assert.deepEqual(classifyCartRefreshFailure(status), {
      kind: "transient",
      shouldClearSession: false,
    });
  });
}

test("a later refresh supersedes an older request", () => {
  const guard = createCartRefreshGuard();
  const olderRequest = guard.begin();
  const newerRequest = guard.begin();

  assert.equal(guard.isCurrent(olderRequest), false);
  assert.equal(guard.isCurrent(newerRequest), true);
});

test("explicit clearing invalidates an in-flight refresh", () => {
  const guard = createCartRefreshGuard();
  const request = guard.begin();

  guard.invalidate();

  assert.equal(guard.isCurrent(request), false);
});

test("a successful retry can become the current result after a transient failure", () => {
  const guard = createCartRefreshGuard();
  const failedRequest = guard.begin();
  const retryRequest = guard.begin();

  assert.equal(guard.isCurrent(failedRequest), false);
  assert.equal(guard.isCurrent(retryRequest), true);
});

test("startup restoration retains its session after a transient failure", () => {
  const restorationFailure = classifyCartRefreshFailure(null);

  assert.equal(restorationFailure.shouldClearSession, false);
});

test("a terminal failure clears the session instead of remaining retryable", () => {
  const terminalFailure = classifyCartRefreshFailure(404);

  assert.equal(terminalFailure.kind, "terminal");
  assert.equal(terminalFailure.shouldClearSession, true);
});
