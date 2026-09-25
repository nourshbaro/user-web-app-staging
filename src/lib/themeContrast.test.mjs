import assert from "node:assert/strict";
import test from "node:test";
import { darkColors, lightColors } from "./themePalette.ts";

function luminance(hex) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

for (const [name, colors] of [["light", lightColors], ["dark", darkColors]]) {
  test(`${name}: semantic text roles meet WCAG AA (4.5:1)`, () => {
    const pairs = [
      ["textStrong/surface", colors.textStrong, colors.surface],
      ["textStrong/background", colors.textStrong, colors.background],
      ["textMuted/surface", colors.textMuted, colors.surface],
      ["textMuted/background", colors.textMuted, colors.background],
      ["onActionPrimary/actionPrimary", colors.onActionPrimary, colors.actionPrimary],
      ["onActionSecondary/actionSecondary", colors.onActionSecondary, colors.actionSecondary],
      ["onActionDestructive/actionDestructive", colors.onActionDestructive, colors.actionDestructive],
      ["disabledText/disabledSurface", colors.disabledText, colors.disabledSurface],
      ["onHero/hero", colors.onHero, colors.hero],
      ["onHeroMuted/hero", colors.onHeroMuted, colors.hero],
    ];
    for (const [pair, fg, bg] of pairs) {
      assert.ok(contrast(fg, bg) >= 4.5, `${pair} is ${contrast(fg, bg).toFixed(2)}:1`);
    }
  });

  test(`${name}: every status tone is readable on its own badge surface`, () => {
    for (const [tone, { fg, bg }] of Object.entries(colors.tones)) {
      assert.ok(contrast(fg, bg) >= 4.5, `${tone} is ${contrast(fg, bg).toFixed(2)}:1`);
    }
  });
}

test("legacy roles are preserved for existing screens", () => {
  for (const colors of [lightColors, darkColors]) {
    for (const key of ["bg", "panel", "panelSoft", "ink", "muted", "line", "primary", "danger", "success"]) {
      assert.equal(typeof colors[key], "string", key);
    }
  }
});

test("scannable QR backdrop stays light in both themes", () => {
  assert.equal(lightColors.scanSurface, "#FFFFFF");
  assert.equal(darkColors.scanSurface, "#FFFFFF");
});
