import assert from "node:assert/strict";
import test from "node:test";
import { groupCartItems } from "./cartDisplay.ts";
import {
  canAdjustQuantity,
  cartViewState,
  countdownParts,
  groupLinesByMatch,
  groupSubtotal,
  quantityChangeConfirmed,
  removalConfirmed,
  reservationUrgency,
  ticketCount,
} from "./cartPresentation.ts";

test("cart view state separates loading, empty, failed refresh, active and expired", () => {
  const base = { sessionId: null, itemCount: 0, refreshError: null, secondsLeft: 0 };
  assert.equal(cartViewState(base), "empty");
  assert.equal(cartViewState({ ...base, sessionId: "S" }), "loading", "a session whose first refresh has not published yet");
  assert.equal(cartViewState({ ...base, sessionId: "S", refreshError: "x" }), "refreshFailed");
  assert.equal(cartViewState({ ...base, sessionId: "S", itemCount: 2, secondsLeft: 300 }), "active");
  assert.equal(cartViewState({ ...base, sessionId: "S", itemCount: 2, secondsLeft: 0 }), "expired");
  assert.equal(cartViewState({ ...base, sessionId: "S", itemCount: 2, secondsLeft: 300, refreshError: "x" }), "active", "stale items stay visible with a warning");
});

test("reservation urgency follows the owner's countdown only", () => {
  assert.equal(reservationUrgency(600), "normal");
  assert.equal(reservationUrgency(121), "normal");
  assert.equal(reservationUrgency(120), "low");
  assert.equal(reservationUrgency(61), "low");
  assert.equal(reservationUrgency(60), "critical");
  assert.equal(reservationUrgency(1), "critical");
  assert.equal(reservationUrgency(0), "expired");
  assert.equal(reservationUrgency(-5), "expired");
  assert.deepEqual(countdownParts(245), { minutes: 4, seconds: 5 });
  assert.deepEqual(countdownParts(-3), { minutes: 0, seconds: 0 });
});

test("missing prices are never shown or summed as zero", () => {
  const lines = groupCartItems([
    { lock_key: "a", match_id: "1", stadium_zone_id: "5", type: "zone", quantity: 2, unit_price: 6, currency: "USD", subtotal: 12, zone_name: "A" },
    { lock_key: "b", match_id: "1", stadium_zone_id: "6", type: "zone", quantity: 1, currency: "USD", zone_name: "B" },
  ]);
  const missing = lines.find((line) => line.zone_name === "B");
  assert.ok(Number.isNaN(missing.unit_price));
  assert.ok(Number.isNaN(missing.subtotal));
  assert.equal(groupSubtotal(lines), null, "one unknown price makes the group subtotal unknown");
  assert.deepEqual(groupSubtotal(lines.slice(0, 1)), { amount: 12, currency: "USD" });
  assert.equal(groupSubtotal([{ subtotal: 5, currency: "USD" }, { subtotal: 5, currency: "LBP" }]), null);
});

test("quantity can be adjusted only on a single GA cart line; seats are removed instead", () => {
  assert.equal(canAdjustQuantity({ lockKeys: ["a"], seats: [] }), true);
  assert.equal(canAdjustQuantity({ lockKeys: ["a"], seats: [{ id: 1 }] }), false);
  assert.equal(canAdjustQuantity({ lockKeys: ["a", "b"], seats: [] }), false);
  assert.equal(ticketCount([{ quantity: 2 }, { quantity: 3 }]), 5);
});

test("lines are grouped by match in cart order", () => {
  const groups = groupLinesByMatch([
    { match_id: "2", match_title: "B v C", key: "x" },
    { match_id: "1", match_title: "A v B", key: "y" },
    { match_id: "2", match_title: "B v C", key: "z" },
  ]);
  assert.deepEqual(groups.map((group) => [group.matchId, group.lines.map((line) => line.key)]), [["2", ["x", "z"]], ["1", ["y"]]]);
});

const published = (sessionId, items) => ({ confirmed: true, snapshot: { sessionId, items } });
const unconfirmed = { confirmed: false, reason: "refresh-failed" };

test("a quantity change is success only when the owner published it for the same, current session", () => {
  const context = { lockKey: "L", quantity: 3, startedInSession: "S", currentSession: "S" };
  assert.equal(quantityChangeConfirmed(published("S", [{ lock_key: "L", quantity: 3 }]), context), true);
  assert.equal(quantityChangeConfirmed(published("S", [{ lock_key: "L", quantity: "3" }]), context), true);
  assert.equal(quantityChangeConfirmed(published("S", [{ lock_key: "L", quantity: 5 }]), context), false, "additive merge is not the requested set");
  assert.equal(quantityChangeConfirmed(published("S", []), context), false);
  assert.equal(quantityChangeConfirmed(unconfirmed, context), false, "a resolved mutation without publication is not success");
  assert.equal(quantityChangeConfirmed(published("S2", [{ lock_key: "L", quantity: 3 }]), { ...context, currentSession: "S2" }), false, "session changed mid-action");
  assert.equal(quantityChangeConfirmed(published("S", [{ lock_key: "L", quantity: 3 }]), { ...context, currentSession: "S2" }), false, "published for a session that is no longer current");
});

test("a removal is success only when the published cart no longer holds the line", () => {
  const context = { lockKeys: ["L1", "L2"], startedInSession: "S", currentSession: "S" };
  assert.equal(removalConfirmed(published("S", [{ lock_key: "other" }]), context), true);
  assert.equal(removalConfirmed(published("S", [{ lock_key: "L2" }]), context), false, "one lock still reserved");
  assert.equal(removalConfirmed(published(null, []), { ...context, currentSession: null }), true, "removing the last line clears the cart");
  assert.equal(removalConfirmed(unconfirmed, context), false, "delete succeeded but refresh failed: not success");
  assert.equal(removalConfirmed(published("S2", []), { ...context, currentSession: "S2" }), false, "another session's cart proves nothing");
  assert.equal(removalConfirmed(published("S", []), { ...context, currentSession: null }), false, "published cart is no longer current");
});
