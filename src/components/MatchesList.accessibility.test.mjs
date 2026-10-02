import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Phase 2 moved the filter UI from MatchesList into a filter bar + bottom
// sheet (src/components/match/MatchFilters.tsx). These tests keep the same
// accessibility intents against the new components. Source-level contracts:
// there is no renderer in this node:test setup.
const filters = await readFile(new URL("./match/MatchFilters.tsx", import.meta.url), "utf8");
const list = await readFile(new URL("./MatchesList.tsx", import.meta.url), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section ${start} not found`);
  return source.slice(from, to);
}

test("filter entry is a named button that reports its sheet state and active count", () => {
  const bar = section(filters, "export function MatchFilterBar", "export function MatchFiltersSheet");
  assert.match(bar, /accessibilityRole="button"/);
  assert.match(bar, /accessibilityLabel=\{count \? plural\("filters\.openActive", count\) : t\("filters\.open"\)\}/);
  assert.match(bar, /aria-expanded=\{sheetOpen\}/);
});

test("clear filters remains a distinct labeled button, never nested in the filter trigger", () => {
  const bar = section(filters, "export function MatchFilterBar", "export function MatchFiltersSheet");
  const trigger = section(bar, "onPress={onOpen}", "</Pressable>");
  assert.doesNotMatch(trigger, /onClear/);
  assert.match(bar, /onPress=\{onClear\}[\s\S]*?accessibilityRole="button"[\s\S]*?accessibilityLabel=\{t\("filters\.clear"\)\}/);
  assert.doesNotMatch(filters, /event\.stopPropagation\(\)/);
});

test("active filters stay visible (v3 summary line by name, plus the count on the entry)", () => {
  // v3 replaces removable chips with a summary ("12 matches · Nejmeh · Fouad Chehab") and Clear.
  assert.match(list, /optionName\(data\.filterOptions\.teams, filters\.team\)/);
  assert.match(list, /optionName\(data\.filterOptions\.stadiums, filters\.stadium\)/);
  assert.match(list, /query\.date \? formatCalendarDate\(query\.date\) : undefined/);
  const bar = section(filters, "export function MatchFilterBar", "export function MatchFiltersSheet");
  assert.match(bar, /\{count \? t\("filters\.openCount", \{ count \}\) : t\("filters\.open"\)\}/);
});

test("team and venue options are a labelled radio group with checked state", () => {
  const group = section(filters, "function OptionGroup", "function OptionPill");
  assert.match(group, /accessibilityRole="radiogroup"/);
  assert.match(group, /accessibilityLabel=\{label\}/);
  const pill = section(filters, "function OptionPill", "function DateFilter");
  assert.match(pill, /accessibilityRole="radio"/);
  assert.match(pill, /aria-checked=\{selected\}/);
});

test("options share one selected predicate for semantics and styling", () => {
  const group = section(filters, "function OptionGroup", "function OptionPill");
  assert.match(group, /selected=\{isDropdownOptionSelected\(selected, row\.slug\)\}/);
  const pill = section(filters, "function OptionPill", "function DateFilter");
  // The same `selected` drives aria-checked, the v3 fill and the heavier weight (not colour alone).
  // Fill and shadow come from the diff-safe chip style helper, driven by the same `selected`.
  assert.match(pill, /filterChipStyle\(\{ selected, pressed, colors: theme\.colors \}\)/);
  assert.match(pill, /fontStyleFor\("text", selected \? "600" : "500", meta\.script\)/);
});

test("date filter exposes field identity and an explicit 'any date' choice", () => {
  const date = section(filters, "function DateFilter", "const local");
  assert.match(date, /accessibilityLabel=\{getDateTriggerLabel\(selectedDate\)\}/);
  const sheet = section(filters, "export function MatchFiltersSheet", "function SectionTitle");
  assert.match(sheet, /label=\{t\("filters\.anyDate"\)\}\s*selected=\{!draft\.filters\.date && !pickingDate\}/);
  // The strip's "All" chip is the same explicit choice.
  assert.match(filters, /accessibilityLabel=\{t\("filters\.anyDate"\)\} wide onPress=\{\(\) => onSelect\(undefined\)\}/);
});

test("real calendar dates expose full labels and selected/disabled state (web-safe aria props)", () => {
  const date = section(filters, "function DateFilter", "const local");
  assert.match(date, /accessibilityLabel=\{formatAccessibleCalendarDate\(date\)\}/);
  assert.match(date, /aria-selected=\{selected\}/);
  assert.match(date, /aria-disabled=\{disabled\}/);
});

test("blank calendar cells are inert Views rather than Pressables", () => {
  assert.match(filters, /<View key=\{`blank-\$\{index\}`\} accessible=\{false\}/);
  assert.doesNotMatch(filters, /<Pressable\s+key=\{`blank-/);
});

test("month navigation has explicit action names, disabled state, and direction-aware chevrons", () => {
  const date = section(filters, "function DateFilter", "const local");
  assert.match(date, /accessibilityLabel=\{t\("filters\.previousMonth"\)\}/);
  assert.match(date, /accessibilityLabel=\{t\("filters\.nextMonth"\)\}/);
  assert.match(date, /aria-disabled=\{!canGoPrevious\}/);
  assert.match(date, /<DirectionalChevron kind="back"/);
  assert.match(date, /<DirectionalChevron kind="forward"/);
});

test("the filter sheet reuses the shared bottom sheet and ends with explicit actions (v3 Reset / Show matches)", () => {
  const sheet = section(filters, "export function MatchFiltersSheet", "function SectionTitle");
  assert.match(sheet, /<BottomSheetModal\s+visible=\{visible\}\s+onClose=\{onClose\}\s+title=\{t\("filters\.sheetTitle"\)\}/);
  assert.match(sheet, /headerAction=\{\{\s*label: t\("filters\.reset"\)/);
  assert.match(sheet, /footer=\{<Button title=\{t\("filters\.apply"\)\} onPress=\{\(\) => onApply\(draft\)\} \/>\}/);
  assert.doesNotMatch(filters, /<Modal[\s>]/, "no nested modal inside the sheet");
});

test("nested control icons are decorative", () => {
  const icons = filters.match(/<SymbolView[\s\S]*?\/>/g) ?? [];
  assert.ok(icons.length > 0);
  for (const icon of icons) assert.match(icon, /accessible=\{false\}/);
});

test("applied filter values stay owned by the Matches screen, not the filter components", () => {
  assert.match(list, /const \[filters, setFilters\] = useState<MatchFilters>\(\{\}\);/);
  assert.match(list, /const \[tab, setTab\] = useState<MatchTab>\(\(\) => matchTabFromParam\(params\.tab\)\);/);
  assert.match(list, /const query = useMemo\(\(\) => matchQueryFor\(filters, tab\), \[filters, tab\]\);/);
  assert.match(list, /useScheduledMatches\(query, \{ withFilterOptions: true \}\)/);
  // The sheet only edits a draft until "Show matches"; it never loads data.
  assert.doesNotMatch(filters, /useState<MatchFilters>|matchesService|useScheduledMatches/);
  assert.match(filters, /const \[draft, setDraft\] = useState<MatchFilterSelection>\(value\);/);
});
