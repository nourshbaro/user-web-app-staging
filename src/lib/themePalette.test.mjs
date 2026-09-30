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

  // LFA Screen v3 (lfa3.css) values.
  assert.equal(light.background, "#F4F4F6");
  assert.equal(light.panelSoft, "#F7F7F9");
  assert.equal(light.primary, "#C8102E");
  assert.equal(light.green, "#0F7A45");
  assert.equal(light.gold, "#C8A84B");
  assert.equal(dark.background, "#0B0B0E");
  assert.equal(dark.panelSoft, "#1D1D23");
  assert.equal(dark.primary, "#E8112D");
  assert.equal(dark.green, "#3FCB85");
  assert.equal(dark.gold, "#F5C518");
  assert.notEqual(light, dark);
});

test("dark then light selection does not mutate either palette", () => {
  const darkSnapshot = { ...getThemeColors("dark") };
  const lightSnapshot = { ...getThemeColors("light") };

  assert.deepEqual(getThemeColors("dark"), darkSnapshot);
  assert.deepEqual(getThemeColors("light"), lightSnapshot);
});
