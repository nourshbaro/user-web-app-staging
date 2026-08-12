import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAccessibleDate,
  getDateTriggerLabel,
  getDropdownTriggerLabel,
  isDropdownOptionSelected,
} from "./matchFilterAccessibility.ts";

test("All is selected only when the selected value is absent", () => {
  assert.equal(isDropdownOptionSelected(undefined, undefined), true);
  assert.equal(isDropdownOptionSelected("team-a", undefined), false);
});

test("a specific dropdown option is selected only by the matching value", () => {
  assert.equal(isDropdownOptionSelected("team-a", "team-a"), true);
  assert.equal(isDropdownOptionSelected("team-a", "team-b"), false);
});

test("dropdown trigger label retains field identity and visible value", () => {
  assert.equal(
    getDropdownTriggerLabel("Team", "All teams"),
    "Team, All teams",
  );
  assert.equal(
    getDropdownTriggerLabel("Venue", "Beirut Municipal Stadium"),
    "Venue, Beirut Municipal Stadium",
  );
});

test("accessible date label contains full deterministic date identity", () => {
  const date = new Date(2026, 7, 12);
  const label = formatAccessibleDate(date, "en-US");

  assert.equal(label, "Wednesday, August 12, 2026");
  assert.notEqual(label, String(date.getDate()));
});

test("date trigger distinguishes no selection from a selected full date", () => {
  assert.equal(
    getDateTriggerLabel(null, "en-US"),
    "Match Date, not selected",
  );
  assert.equal(
    getDateTriggerLabel(new Date(2026, 7, 12), "en-US"),
    "Match Date, Wednesday, August 12, 2026",
  );
});

test("accessibility helpers do not alter underlying values or dates", () => {
  const selectedValue = "team-a";
  const optionValue = "team-a";
  const date = new Date(2026, 7, 12);
  const originalTime = date.getTime();

  isDropdownOptionSelected(selectedValue, optionValue);
  getDropdownTriggerLabel("Team", "Team A");
  formatAccessibleDate(date, "en-US");
  getDateTriggerLabel(date, "en-US");

  assert.equal(selectedValue, "team-a");
  assert.equal(optionValue, "team-a");
  assert.equal(date.getTime(), originalTime);
});