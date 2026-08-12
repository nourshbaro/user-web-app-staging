import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./MatchesList.tsx", import.meta.url),
  "utf8",
);

test("filter toggle exposes button and expanded semantics", () => {
  assert.match(source, /accessibilityLabel="Filter matches"/);
  assert.match(
    source,
    /accessibilityState=\{\{\s*expanded:\s*filtersOpen\s*\}\}/,
  );
});

test("clear filters remains a distinct labeled button", () => {
  assert.match(source, /accessibilityLabel="Clear match filters"/);
  assert.doesNotMatch(source, /event\.stopPropagation\(\)/);
  assert.match(source, /<View style=\{local\.filterHeader\}>/);
});

test("dropdown triggers expose their field value and expanded state", () => {
  assert.match(
    source,
    /accessibilityLabel=\{getDropdownTriggerLabel\(label,\s*value\)\}/,
  );
  assert.match(
    source,
    /accessibilityState=\{\{\s*expanded:\s*open\s*\}\}/,
  );
});

test("dropdown options share one selected predicate for semantics and styling", () => {
  assert.match(
    source,
    /const optionSelected = isDropdownOptionSelected\(/,
  );
  assert.match(
    source,
    /accessibilityState=\{\{\s*selected:\s*optionSelected\s*\}\}/,
  );
  assert.doesNotMatch(
    source,
    /option\.value === undefined && local\.optionTextActive/,
  );
});

test("date trigger exposes field identity and calendar state", () => {
  assert.match(
    source,
    /accessibilityLabel=\{getDateTriggerLabel\(/,
  );
  assert.match(
    source,
    /accessibilityState=\{\{\s*expanded:\s*calendarOpen\s*\}\}/,
  );
});

test("real calendar dates expose full labels and selected disabled state", () => {
  assert.match(
    source,
    /accessibilityLabel=\{formatAccessibleDate\(date\)\}/,
  );
  assert.match(
    source,
    /accessibilityState=\{\{\s*selected,\s*disabled,\s*\}\}/,
  );
});

test("blank calendar cells are inert Views rather than Pressables", () => {
  assert.match(source, /key=\{`blank-\$\{index\}`\}/);
  assert.match(
    source,
    /<View\s+key=\{`blank-\$\{index\}`\}\s+accessible=\{false\}/,
  );
  assert.doesNotMatch(
    source,
    /<Pressable\s+key=\{date \? toDateInputValue\(date\) : `blank-/,
  );
});

test("month navigation has explicit action names and disabled state", () => {
  assert.match(source, /accessibilityLabel="Previous month"/);
  assert.match(source, /accessibilityLabel="Next month"/);
  assert.match(
    source,
    /accessibilityState=\{\{\s*disabled:\s*!canGoPrevious\s*\}\}/,
  );
});

test("calendar Close control has an explicit button role", () => {
  assert.match(
    source,
    /onPress=\{onClose\}[\s\S]*?accessibilityRole="button"[\s\S]*?>[\s\S]*?Close/,
  );
});

test("nested control icons are decorative", () => {
  assert.match(
    source,
    /<SymbolView\s+accessible=\{false\}/,
  );
});