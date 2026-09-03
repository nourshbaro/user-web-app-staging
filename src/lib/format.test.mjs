import assert from "node:assert/strict";
import test from "node:test";
import { formatTime } from "./format.ts";

test("clock-only API values use 12-hour presentation without timezone conversion", () => {
  assert.equal(formatTime("08:00"), "8:00 AM");
  assert.equal(formatTime("13:30:00"), "1:30 PM");
  assert.equal(formatTime("20:15"), "8:15 PM");
});

test("invalid and missing clock values have a stable fallback", () => {
  assert.equal(formatTime(), "TBC");
  assert.equal(formatTime("25:00"), "TBC");
});
