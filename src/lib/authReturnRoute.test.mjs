import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getSafeAuthReturnRoute } from "./authReturnRoute.ts";

test("auth return routes accept app destinations and reject arbitrary values", () => {
  for (const route of ["/", "/cart", "/checkout", "/match/42", "/match/final_2026"]) {
    assert.equal(getSafeAuthReturnRoute(route), route);
  }
  for (const route of ["https://evil.example", "//evil.example", "/auth", "/match/a/b", "javascript:alert(1)"]) {
    assert.equal(getSafeAuthReturnRoute(route), null);
  }
});

test("login returns to a validated origin and never defaults to Profile", async () => {
  const source = await readFile(new URL("../app/auth.tsx", import.meta.url), "utf8");
  const required = await readFile(new URL("../components/AuthRequired.tsx", import.meta.url), "utf8");

  assert.match(required, /params: \{ returnTo \}/);
  assert.match(source, /router\.dismissTo\(returnTo as never\)/);
  assert.match(source, /else router\.replace\("\/"\)/);
  assert.doesNotMatch(source, /router\.replace\("\/profile"\)/);
});

test("match login preserves the active match route", async () => {
  const source = await readFile(new URL("../app/match/[id].tsx", import.meta.url), "utf8");
  assert.match(source, /params: \{ returnTo: `\/match\/\$\{encodeURIComponent\(routeMatchId\)\}` \}/);
});
