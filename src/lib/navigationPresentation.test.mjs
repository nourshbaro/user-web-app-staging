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
