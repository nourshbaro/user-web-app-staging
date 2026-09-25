import assert from "node:assert/strict";
import test from "node:test";
import {
  breakpoints,
  layout,
  lineHeightForScript,
  pageGutter,
  size,
  typography,
} from "./designTokens.ts";

test("interactive sizes meet the 44pt minimum and prefer 48", () => {
  assert.ok(size.touchTargetMin >= 44);
  assert.ok(size.touchTarget >= 48);
  assert.ok(size.controlHeight >= size.touchTargetMin);
  assert.ok(size.controlHeightCompact >= 40);
});

test("typography never relies on letter-spacing and leaves room for wrapped lines", () => {
  for (const [name, token] of Object.entries(typography)) {
    assert.equal("letterSpacing" in token, false, `${name} sets letterSpacing`);
    assert.ok(token.lineHeight >= token.fontSize * 1.2, `${name} line height is too tight`);
    assert.ok(token.fontSize >= 12, `${name} is below the 12pt floor`);
  }
});

test("numeric variants use tabular digits for prices and totals", () => {
  assert.deepEqual(typography.numeric.fontVariant, ["tabular-nums"]);
  assert.deepEqual(typography.numericLarge.fontVariant, ["tabular-nums"]);
});

test("Arabic script gets extra line height; Latin is unchanged", () => {
  assert.equal(lineHeightForScript(typography.body, "latin"), typography.body.lineHeight);
  assert.ok(lineHeightForScript(typography.body, "arabic") > typography.body.lineHeight);
});

test("breakpoints and gutters match the established responsive helper", () => {
  assert.deepEqual(breakpoints, { narrow: 390, tablet: 768, desktop: 1024 });
  assert.equal(layout.maxContentWidth, 1180);
  assert.equal(pageGutter(360), layout.gutterNarrow);
  assert.equal(pageGutter(414), layout.gutter);
  assert.equal(pageGutter(820), layout.gutterTablet);
});
