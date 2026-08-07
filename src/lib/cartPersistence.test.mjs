import assert from "node:assert/strict";
import test from "node:test";
import {
  isCartExpiryReached,
  parsePersistedCartSession,
  serializePersistedCartSession,
} from "./cartPersistence.ts";
import { createCartRefreshGuard } from "./cartRefreshPolicy.ts";

const now = Date.parse("2026-08-07T12:00:00.000Z");
const sessionId = "session-a";
const futureExpiry = "2026-08-07T12:15:00.123Z";
const pastExpiry = "2026-08-07T11:59:59.999Z";

function structured(expiresAt = futureExpiry) {
  const value = serializePersistedCartSession(sessionId, expiresAt);
  assert.notEqual(value, null);
  return value;
}

test("structured unexpired session parses as active", () => {
  assert.deepEqual(parsePersistedCartSession(structured(), now), {
    kind: "active",
    sessionId,
    expiresAt: futureExpiry,
    expiresAtMs: Date.parse(futureExpiry),
  });
});

test("structured expired session parses as expired", () => {
  assert.equal(parsePersistedCartSession(structured(pastExpiry), now).kind, "expired");
});

test("expiry equal to now is expired", () => {
  assert.equal(parsePersistedCartSession(structured(new Date(now).toISOString()), now).kind, "expired");
});

test("authoritative expiry survives serialization exactly", () => {
  const parsed = parsePersistedCartSession(structured(), now);
  assert.equal(parsed.kind, "active");
  assert.equal(parsed.expiresAt, futureExpiry);
});

test("restart classification never derives or extends expiry", () => {
  const laterNow = Date.parse("2026-08-07T12:20:00.000Z");
  const parsed = parsePersistedCartSession(structured(), laterNow);
  assert.equal(parsed.kind, "expired");
  assert.equal(parsed.expiresAt, futureExpiry);
});

test("legacy raw session remains recognized", () => {
  assert.deepEqual(parsePersistedCartSession("old-session-id", now), {
    kind: "legacy",
    sessionId: "old-session-id",
  });
});

test("malformed intended structured data is rejected", () => {
  assert.deepEqual(parsePersistedCartSession("{not-json", now), { kind: "malformed" });
});

test("structured data without a session ID is rejected", () => {
  assert.deepEqual(
    parsePersistedCartSession(JSON.stringify({ version: 1, expiresAt: futureExpiry }), now),
    { kind: "malformed" },
  );
});

test("structured data with an invalid expiry is rejected", () => {
  assert.deepEqual(
    parsePersistedCartSession(JSON.stringify({ version: 1, sessionId, expiresAt: "invalid" }), now),
    { kind: "malformed" },
  );
});

test("unsupported persistence version is rejected", () => {
  assert.deepEqual(
    parsePersistedCartSession(JSON.stringify({ version: 2, sessionId, expiresAt: futureExpiry }), now),
    { kind: "malformed" },
  );
});

test("active session reopened offline remains retainable", () => {
  assert.equal(parsePersistedCartSession(structured(), now).kind, "active");
});

test("known-expired session is locally removable without network", () => {
  assert.equal(parsePersistedCartSession(structured(pastExpiry), now).kind, "expired");
});

test("expired startup record does not expose an old active session identity", () => {
  const parsed = parsePersistedCartSession(structured(pastExpiry), now);
  const restoredSessionId = parsed.kind === "active" || parsed.kind === "legacy" ? parsed.sessionId : null;
  assert.equal(restoredSessionId, null);
});

test("expiry cleanup invalidates old refresh ownership", () => {
  const guard = createCartRefreshGuard();
  const oldRefresh = guard.begin();
  guard.invalidate();
  assert.equal(guard.isCurrent(oldRefresh), false);
});

test("new Add-to-Cart after expired startup receives no old identity", () => {
  const parsed = parsePersistedCartSession(structured(pastExpiry), now);
  const activeMutationSession = parsed.kind === "active" || parsed.kind === "legacy" ? parsed.sessionId : null;
  assert.equal(activeMutationSession, null);
});

test("foreground known-expired decision expires", () => {
  assert.equal(isCartExpiryReached(new Date(pastExpiry), now), true);
  assert.equal(isCartExpiryReached(new Date(now), now), true);
});

test("foreground unexpired decision does nothing", () => {
  assert.equal(isCartExpiryReached(new Date(futureExpiry), now), false);
  assert.equal(isCartExpiryReached(null, now), false);
});
