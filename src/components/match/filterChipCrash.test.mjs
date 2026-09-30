import assert from "node:assert/strict";
import test from "node:test";
import { replayStyles } from "../../test-support/rnStyleDiff.mjs";
import { dateChipStyle, filterChipStyle } from "./filterChipStyle.ts";
import { appTextBaseStyle } from "../foundation/appTextStyle.ts";
import { typography } from "../../lib/designTokens.ts";
import { lightColors, darkColors } from "../../lib/themePalette.ts";

// Regression for the device crash "TypeError: Cannot read property 'forEach'
// of null" when pressing any Matches filter chip. These tests run React
// Native's REAL renderer style diff (ReactNativeAttributePayload.diff with the
// real processTransform/processFontVariant, __DEV__ on) over the exact style
// props the chips produce across a press → release → select interaction.

const pillBase = { minHeight: 38, paddingHorizontal: 14, borderRadius: 12 };
const chip = (colors, selected, pressed) => [pillBase, filterChipStyle({ selected, pressed, colors })];
const dateChip = (colors, selected, pressed) => [{ minHeight: 62, borderRadius: 16 }, dateChipStyle({ selected, pressed, colors })];

test("the harness reproduces the original crash (explicit `transform: undefined` on release)", () => {
  const original = (pressed) => [pillBase, { backgroundColor: "#FFFFFF", transform: pressed ? [{ scale: 0.96 }] : undefined }];
  assert.throws(() => replayStyles([original(false), original(true), original(false)]), /forEach/);
});

for (const [theme, colors] of [["light", lightColors], ["dark", darkColors]]) {
  test(`${theme}: a filter chip survives press, release, select and deselect through the renderer diff`, () => {
    // Tap an unselected chip (it becomes selected), then tap it / another chip again.
    const sequence = [
      chip(colors, false, false),
      chip(colors, false, true),
      chip(colors, true, false),
      chip(colors, true, true),
      chip(colors, false, false),
      chip(colors, false, true),
      chip(colors, false, false),
    ];
    const payloads = replayStyles(sequence);
    // The renderer flattens style into the update payload: the press is applied, then cleared on release.
    assert.deepEqual(payloads[0].transform, [{ scale: 0.96 }]);
    assert.equal(payloads[1].transform, null);
    assert.ok(payloads.some((payload) => payload && "boxShadow" in payload));
  });

  test(`${theme}: every chip state transition is safe (all 4×4 pairs)`, () => {
    const states = [[false, false], [false, true], [true, false], [true, true]];
    for (const [from, to] of states.flatMap((a) => states.map((b) => [a, b]))) {
      assert.doesNotThrow(() => replayStyles([chip(colors, ...from), chip(colors, ...to)]), `${from} → ${to}`);
      assert.doesNotThrow(() => replayStyles([dateChip(colors, ...from), dateChip(colors, ...to)]), `date ${from} → ${to}`);
    }
  });
}

test("chip styles never carry an explicit undefined processed key", () => {
  for (const selected of [false, true]) {
    for (const pressed of [false, true]) {
      for (const style of [filterChipStyle({ selected, pressed, colors: lightColors }), dateChipStyle({ selected, pressed, colors: lightColors })]) {
        for (const [key, value] of Object.entries(style)) assert.notEqual(value, undefined, key);
      }
    }
  }
});

test("AppText base styles are diff-safe when an element changes between numeric and plain variants", () => {
  const style = (variant) => [
    appTextBaseStyle({
      token: typography[variant],
      lineHeight: typography[variant].lineHeight,
      fontStyle: { fontWeight: typography[variant].fontWeight },
      color: "#15161C",
      align: "start",
      latin: true,
    }),
  ];
  // e.g. a chip label switching displayNumeral (tabular digits) ↔ label, and a display title ↔ body.
  assert.doesNotThrow(() => replayStyles([style("displayNumeral"), style("label"), style("displayNumeral"), style("displayTitle"), style("body")]));
  for (const variant of Object.keys(typography)) {
    for (const [key, value] of Object.entries(style(variant)[0])) assert.notEqual(value, undefined, `${variant}.${key}`);
  }
});
