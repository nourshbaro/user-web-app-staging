import type { ApiMatch } from "@/types";

export function matchTitle(match?: ApiMatch | null) {
  if (!match) return "Match";
  return `${match.home_team?.name ?? "Home"} vs ${match.away_team?.name ?? "Away"}`;
}

export function formatDate(value?: string) {
  if (!value) return "Date TBC";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(value));
}

export function formatTime(value?: string) {
  return value ? value.slice(0, 5) : "TBC";
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
