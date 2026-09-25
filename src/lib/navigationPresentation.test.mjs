import assert from "node:assert/strict";
import test from "node:test";
import { adjacentPrimaryTab, shouldShowBottomNavigation } from "./navigationPresentation.ts";

test("bottom navigation is limited to primary destinations", () => {
  for (const route of ["/", "/tournament", "/matches", "/tickets", "/profile"]) {
    assert.equal(shouldShowBottomNavigation(route), true, route);
  }
});

test("primary tabs page to adjacent siblings without wrapping or stacking", () => {
  assert.equal(adjacentPrimaryTab("/", 1), "/tournament");
  assert.equal(adjacentPrimaryTab("/tournament", -1), "/");
  assert.equal(adjacentPrimaryTab("/tickets", 1), "/profile");
  assert.equal(adjacentPrimaryTab("/profile", 1), null);
  assert.equal(adjacentPrimaryTab("/match/42", 1), null);
});

test("child and workflow routes hide bottom navigation", () => {
  for (const route of ["/edit-profile", "/settings", "/about", "/match/42", "/auth", "/checkout", "/cart"]) {
    assert.equal(shouldShowBottomNavigation(route), false, route);
  }
});

test("swipe direction follows reading direction: leftward = next in LTR, rightward = next in RTL", async () => {
  const { swipeTabStep } = await import("./navigationPresentation.ts");
  assert.equal(swipeTabStep(-120, false), 1);
  assert.equal(swipeTabStep(120, false), -1);
  assert.equal(swipeTabStep(120, true), 1);
  assert.equal(swipeTabStep(-120, true), -1);
});

test("tab entrance offset mirrors in RTL so content arrives from the matching side", async () => {
  const { tabEntranceOffset } = await import("./navigationPresentation.ts");
  assert.equal(tabEntranceOffset(1, false), 10);
  assert.equal(tabEntranceOffset(-1, false), -10);
  assert.equal(tabEntranceOffset(1, true), -10);
  assert.equal(tabEntranceOffset(-1, true), 10);
});
