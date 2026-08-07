import assert from "node:assert/strict";
import test from "node:test";
import { darkColors, getThemeColors, lightColors } from "./themePalette.ts";

test("light and dark palette selection returns the authoritative palettes", () => {
  assert.equal(getThemeColors("light"), lightColors);
  assert.equal(getThemeColors("dark"), darkColors);
});

test("light then dark selection keeps independent theme values", () => {
  const light = getThemeColors("light");
  const dark = getThemeColors("dark");

  assert.equal(light.panelSoft, "#F8FAFC");
  assert.equal(light.primary, "#C8102E");
  assert.equal(light.green, "#007A3D");
  assert.equal(light.gold, "#C8A84B");
  assert.equal(dark.panelSoft, "#111827");
  assert.equal(dark.primary, "#E8112D");
  assert.equal(dark.green, "#22C55E");
  assert.equal(dark.gold, "#F5C518");
  assert.notEqual(light, dark);
});

test("dark then light selection does not mutate either palette", () => {
  const darkSnapshot = { ...getThemeColors("dark") };
  const lightSnapshot = { ...getThemeColors("light") };

  assert.deepEqual(getThemeColors("dark"), darkSnapshot);
  assert.deepEqual(getThemeColors("light"), lightSnapshot);
});
