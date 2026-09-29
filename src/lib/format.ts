import type { ApiMatch } from "@/types";

/**
 * Presentation-only formatting. The locale follows the *app* language (set by
 * `I18nProvider` via `setFormatLocale`), never the device locale, so dates and
 * money match the interface language. Values and calculations are untouched.
 */
let formatLocaleTag = "en-US";

export function setFormatLocale(tag: string) {
  formatLocaleTag = tag;
}

export function getFormatLocale() {
  return formatLocaleTag;
}

export function matchTitle(match?: ApiMatch | null) {
  if (!match) return "Match";
  return `${match.home_team?.name ?? "Home"} vs ${match.away_team?.name ?? "Away"}`;
}

export function formatDate(value?: string) {
  if (!value) return "Date TBC";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBC";
  return new Intl.DateTimeFormat(formatLocaleTag, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

/** Parses "YYYY-MM-DD" as a local calendar date (not UTC midnight, which can shift the day). */
export function parseCalendarDate(value?: string | null) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!parts) return null;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar-date label for backend `match_date` values ("Thu, Oct 22"). */
export function formatCalendarDate(value?: string | null) {
  const date = parseCalendarDate(value);
  if (!date) return "Date TBC";
  return new Intl.DateTimeFormat(formatLocaleTag, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

/** Full spoken date for assistive tech ("Thursday, October 22, 2026"). */
export function formatAccessibleCalendarDate(date: Date) {
  return new Intl.DateTimeFormat(formatLocaleTag, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
}

export function formatMonthYear(date: Date) {
  return new Intl.DateTimeFormat(formatLocaleTag, { month: "long", year: "numeric" }).format(date);
}

/** Short weekday name ("Sun") in the app locale. */
export function formatWeekdayShort(date: Date) {
  return new Intl.DateTimeFormat(formatLocaleTag, { weekday: "short" }).format(date);
}

/** Day-of-month numeral ("3") in the app locale, for compact date tiles and chips. */
export function formatDayOfMonth(date: Date) {
  return new Intl.DateTimeFormat(formatLocaleTag, { day: "numeric" }).format(date);
}

/** Long calendar-date heading ("Saturday, October 3") for backend `match_date` values. */
export function formatLongCalendarDate(value?: string | null) {
  const date = parseCalendarDate(value);
  if (!date) return "Date TBC";
  return new Intl.DateTimeFormat(formatLocaleTag, { weekday: "long", month: "long", day: "numeric" }).format(date);
}

export function formatTime(value?: string) {
  if (!value) return "TBC";

  // API kickoff values are sometimes clock-only values. Parsing those as a Date
  // would incorrectly introduce a timezone, so format them without conversion.
  const clock = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (clock) {
    const hour = Number(clock[1]);
    if (hour > 23) return "TBC";
    if (formatLocaleTag === "en-US") {
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${clock[2]} ${hour < 12 ? "AM" : "PM"}`;
    }
    // Other locales: format the wall-clock value in UTC so no offset is applied.
    return new Intl.DateTimeFormat(formatLocaleTag, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(Date.UTC(2000, 0, 1, hour, Number(clock[2])));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat(formatLocaleTag, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTime(value?: string) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(formatLocaleTag, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Shown instead of an amount when the value is missing or not a finite number,
 * so corrupted data can never look like a genuine (e.g. free) price. Like the
 * other fallbacks in this module, it moves to the catalog with its screens.
 */
export const MONEY_UNAVAILABLE = "Price unavailable";

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

/**
 * Amount with two decimals and locale grouping, followed by the backend
 * currency code. Presentation only: it never alters the value callers keep.
 */
export function formatMoney(value?: number | string | null, currency = "USD") {
  const amount = parseAmount(value);
  if (amount === null) return MONEY_UNAVAILABLE;
  // Capability check: never assume an Intl constructor exists on every JS engine.
  const number = typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function"
    ? new Intl.NumberFormat(formatLocaleTag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    : amount.toFixed(2);
  return `${number} ${currency}`;
}

export function minutesSeconds(seconds: number) {
  const min = Math.floor(seconds / 60).toString().padStart(2, "0");
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}
