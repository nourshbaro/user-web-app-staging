import assert from "node:assert/strict";
import test from "node:test";
import { getEffectiveSelectedSeats, getOwnedMapHeight } from "./matchLifecycle.ts";

test("cart-owned seats are excluded from effective selection", () => {
  assert.deepEqual(getEffectiveSelectedSeats([1, 2, 3], "match-a:zone-a", "match-a:zone-a", new Set([2])), [1, 3]);
});

test("all cart-owned selected seats produce an empty effective selection", () => {
  assert.deepEqual(getEffectiveSelectedSeats([1, 2], "match-a:zone-a", "match-a:zone-a", new Set([1, 2])), []);
});

test("selection remains unchanged when the cart owns none of it", () => {
  assert.deepEqual(getEffectiveSelectedSeats([1, 2], "match-a:zone-a", "match-a:zone-a", new Set()), [1, 2]);
});

test("a different zone cannot inherit selection with the same seat ID", () => {
  assert.deepEqual(getEffectiveSelectedSeats([1], "match-a:zone-a", "match-a:zone-b", new Set()), []);
});

test("the same numeric zone ID in a different match cannot inherit selection", () => {
  assert.deepEqual(getEffectiveSelectedSeats([1], "match-a:zone-10", "match-b:zone-10", new Set()), []);
});

test("the already-active match and zone preserve actionable selection", () => {
  assert.deepEqual(getEffectiveSelectedSeats([1], "match-a:zone-10", "match-a:zone-10", new Set()), [1]);
});

test("effective count and payload exclude cart-owned seats", () => {
  const effective = getEffectiveSelectedSeats([1, 2, 3], "match-a:zone-a", "match-a:zone-a", new Set([2]));
  assert.equal(effective.length, 2);
  assert.deepEqual({ seat_ids: effective }, { seat_ids: [1, 3] });
});

test("a new map identity uses fallback instead of the previous measurement", () => {
  assert.equal(getOwnedMapHeight({ identity: "map-a", height: 500 }, "map-b", 445), 445);
});

test("the current map measurement replaces fallback", () => {
  assert.equal(getOwnedMapHeight({ identity: "map-b", height: 520 }, "map-b", 445), 520);
});

test("a late old-map measurement cannot become active for the current map", () => {
  const lateMapA = { identity: "map-a", height: 500 };
  assert.equal(getOwnedMapHeight(lateMapA, "map-b", 460), 460);
});
