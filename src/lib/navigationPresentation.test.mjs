import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowBottomNavigation } from "./navigationPresentation.ts";

test("bottom navigation is limited to primary destinations", () => {
  for (const route of ["/", "/tournament", "/matches", "/tickets", "/profile"]) {
    assert.equal(shouldShowBottomNavigation(route), true, route);
  }
});

test("child and workflow routes hide bottom navigation", () => {
  for (const route of ["/edit-profile", "/settings", "/about", "/match/42", "/auth", "/checkout", "/cart"]) {
    assert.equal(shouldShowBottomNavigation(route), false, route);
  }
});
