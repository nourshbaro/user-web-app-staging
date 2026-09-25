import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatMoney, formatTime, getFormatLocale, MONEY_UNAVAILABLE, setFormatLocale } from "./format.ts";

test("formatting follows the app locale, defaulting to English (not the device locale)", () => {
  assert.equal(getFormatLocale(), "en-US");
  assert.equal(formatDate("2026-09-24T12:00:00Z"), new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date("2026-09-24T12:00:00Z")));
});

test("money keeps two decimals and the backend currency code, with locale grouping", () => {
  assert.equal(formatMoney(0, "USD"), "0.00 USD", "a real zero stays a real zero");
  assert.equal(formatMoney("0", "USD"), "0.00 USD");
  assert.equal(formatMoney(240, "USD"), "240.00 USD");
  assert.equal(formatMoney(12.5, "USD"), "12.50 USD");
  assert.equal(formatMoney("1250.5", "USD"), "1,250.50 USD");
  assert.equal(formatMoney(-15, "USD"), "-15.00 USD");
});

test("money formatting does not require Intl.NumberFormat to exist", () => {
  const original = Intl.NumberFormat;
  Object.defineProperty(Intl, "NumberFormat", { value: undefined, configurable: true, writable: true });
  try {
    assert.equal(formatMoney(0, "USD"), "0.00 USD");
    assert.equal(formatMoney(12.5, "USD"), "12.50 USD");
    assert.equal(formatMoney("oops", "USD"), MONEY_UNAVAILABLE);
  } finally {
    Object.defineProperty(Intl, "NumberFormat", { value: original, configurable: true, writable: true });
  }
});

test("invalid or missing money is never rendered as a genuine amount", () => {
  const invalid = [NaN, Infinity, -Infinity, "not-a-number", "", "   ", undefined, null];
  for (const value of invalid) {
    const output = formatMoney(value, "LBP");
    assert.equal(output, MONEY_UNAVAILABLE, `${String(value)} produced ${output}`);
    assert.doesNotMatch(output, /\d/, `${String(value)} must not show digits`);
    assert.doesNotMatch(output, /LBP/, `${String(value)} must not look like an LBP amount`);
  }
});

test("a non-English app locale formats clock-only values without timezone shifts", () => {
  setFormatLocale("ar-LB");
  try {
    const expected = new Intl.DateTimeFormat("ar-LB", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
      .format(Date.UTC(2000, 0, 1, 8, 0));
    assert.equal(formatTime("08:00"), expected);
  } finally {
    setFormatLocale("en-US");
  }
});

test("clock-only API values use 12-hour presentation without timezone conversion", () => {
  assert.equal(formatTime("08:00"), "8:00 AM");
  assert.equal(formatTime("13:30:00"), "1:30 PM");
  assert.equal(formatTime("20:15"), "8:15 PM");
});

test("invalid and missing clock values have a stable fallback", () => {
  assert.equal(formatTime(), "TBC");
  assert.equal(formatTime("25:00"), "TBC");
});

test("match calendar dates are parsed as local dates, never shifted by UTC", async () => {
  const { formatCalendarDate, parseCalendarDate } = await import("./format.ts");
  const parsed = parseCalendarDate("2026-10-22");
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 9);
  assert.equal(parsed.getDate(), 22);
  assert.equal(parseCalendarDate("22/10/2026"), null);
  assert.equal(formatCalendarDate("2026-10-22"), new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(2026, 9, 22)));
  assert.equal(formatCalendarDate(undefined), "Date TBC");
});

test("calendar labels follow the app locale", async () => {
  const { formatMonthYear, formatWeekdayShort, formatAccessibleCalendarDate } = await import("./format.ts");
  assert.equal(formatMonthYear(new Date(2026, 9, 1)), "October 2026");
  assert.equal(formatWeekdayShort(new Date(2023, 0, 1)), "Sun");
  assert.equal(formatAccessibleCalendarDate(new Date(2026, 7, 12)), "Wednesday, August 12, 2026");
});
