import assert from "node:assert/strict";
import test from "node:test";
import { getActiveBillingForm, getActiveCaptureState } from "./checkoutOwnership.ts";

test("session A capture state is inactive for session B", () => {
  assert.equal(getActiveCaptureState({ sessionId: "A", status: "ready", context: "context-a" }, "B"), null);
});

test("prior capture state is inactive for a null session", () => {
  assert.equal(getActiveCaptureState({ sessionId: "A", status: "error", error: "failed" }, null), null);
});

test("the current session capture context is active", () => {
  assert.deepEqual(
    getActiveCaptureState({ sessionId: "B", status: "ready", context: "context-b" }, "B"),
    { sessionId: "B", status: "ready", context: "context-b" },
  );
});

test("user A billing data is inactive for user B even with matching visible fields", () => {
  const userA = { owner: "id:1", name: "Same", email: "same@example.com", phone: "+961 01 111 111" };
  const userB = { owner: "id:2", name: "Same", email: "same@example.com", phone: "+961" };
  assert.deepEqual(getActiveBillingForm(userA, "id:2", userB), userB);
});

test("logout makes authenticated billing data inactive", () => {
  const userA = { owner: "id:1", name: "User A", email: "a@example.com", phone: "+961 01 111 111" };
  const guest = { owner: null, name: "", email: "", phone: "+961" };
  assert.deepEqual(getActiveBillingForm(userA, null, guest), guest);
});

test("current-user billing result is active", () => {
  const current = { owner: "id:2", name: "User B", email: "b@example.com", phone: "+961 02 222 222" };
  assert.equal(getActiveBillingForm(current, "id:2", current), current);
});

test("current-user edited billing values remain active", () => {
  const edited = { owner: "id:2", name: "Edited", email: "edited@example.com", phone: "+961 03 333 333" };
  const fallback = { owner: "id:2", name: "Original", email: "original@example.com", phone: "+961" };
  assert.equal(getActiveBillingForm(edited, "id:2", fallback), edited);
});
