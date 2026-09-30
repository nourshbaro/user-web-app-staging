import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/match/[id].tsx", import.meta.url), "utf8");

test("a selected GA zone always renders the local quantity stepper", () => {
  assert.match(source, /selectedZone\.has_seats \? null : \(\s*<View style=\{local\.barRow\}>[\s\S]*?<GaZoneStepper/);
  assert.match(source, /next\.set\(zoneId, Math\.max\(0, quantity\)\)/);
});

test("only stadium selection creates the temporary match-owned focus", () => {
  assert.match(source, /fromStadium \? \{ matchId: routeMatchId, zoneId: zone\.id \} : null/);
  assert.match(source, /onSelectZone=\{\(zone\) => selectZone\(zone, true, true\)\}/);
});

test("both GA quantity controls clear stadium focus and remain local", () => {
  const increment = source.slice(source.indexOf("const incrementGaDraft"), source.indexOf("const decrementGaDraft"));
  const decrement = source.slice(source.indexOf("const decrementGaDraft"), source.indexOf("const gaChanges = gaCartChanges"));
  for (const handler of [increment, decrement]) {
    assert.match(handler, /setStadiumFocusedZone\(null\)/);
    assert.match(handler, /setDraftQuantity/);
    assert.doesNotMatch(handler, /cart\.(addItem|updateItem|removeItem)/);
  }
});
