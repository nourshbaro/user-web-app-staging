import type { ApiMatch } from "@/types";

export function matchTitle(match?: ApiMatch | null) {
  if (!match) return "Match";
  return `${match.home_team?.name ?? "Home"} vs ${match.away_team?.name ?? "Away"}`;
}

export function formatDate(value?: string) {
  if (!value) return "Date TBC";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBC";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function formatTime(value?: string) {
  if (!value) return "TBC";

  // API kickoff values are sometimes clock-only values. Parsing those as a Date
  // would incorrectly introduce a timezone, so format them without conversion.
  const clock = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (clock) {
    const hour = Number(clock[1]);
    if (hour > 23) return "TBC";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${clock[2]} ${hour < 12 ? "AM" : "PM"}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDateTime(value?: string) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatMoney(value?: number | string, currency = "USD") {
  const amount = Number(value ?? 0);
  return `${amount.toFixed(2)} ${currency}`;
}

export function minutesSeconds(seconds: number) {
  const min = Math.floor(seconds / 60).toString().padStart(2, "0");
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}
