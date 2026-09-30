/**
 * Match-discovery presentation rules (pure module, unit-tested).
 *
 * Backend reality (see docs/API_INTEGRATION.md §5): `/matches/scheduled`
 * returns scheduled fixtures only — `match_date` ("YYYY-MM-DD"), a clock-only
 * or ISO `kickoff_at`, and a `status` string. There is no live, score, result
 * or competition data, so nothing here derives those states.
 *
 * Timezone: the backend contract for `match_date` + clock-only `kickoff_at` is
 * not documented. These values are read as local wall-clock time (as the app
 * already did); nothing here converts to or from UTC.
 */
import type { ApiMatch, MatchFilters } from "@/types";
import type { StatusTone } from "./themePalette";

/** A real calendar date, or null (rejects e.g. 2026-02-30 instead of rolling it into March). */
function parseStrictCalendarDate(value: string | null | undefined) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value ?? "");
  if (!parts) return null;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Kickoff timestamp, or null when it is UNKNOWN. Valid only when `match_date`
 * is a real calendar date and `kickoff_at` is a clock time with in-range
 * hour/minute/second (or a well-formed ISO datetime). Missing or malformed
 * data is never normalized into a fake time such as midnight.
 */
export function matchKickoffTime(match: Pick<ApiMatch, "match_date" | "kickoff_at">): number | null {
  const kickoff = (match.kickoff_at ?? "").trim();

  const clock = CLOCK.exec(kickoff);
  if (clock) {
    const date = parseStrictCalendarDate(match.match_date);
    if (!date) return null;
    const [hour, minute, second] = [Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0)];
    if (hour > 23 || minute > 59 || second > 59) return null;
    return new Date(date.year, date.month - 1, date.day, hour, minute, second).getTime();
  }

  if (ISO_DATETIME.test(kickoff) && parseStrictCalendarDate(kickoff)) {
    const time = Date.parse(kickoff);
    return Number.isFinite(time) ? time : null;
  }

  return null;
}

/** Ascending by kickoff; matches with unknown kickoff keep their order at the end. */
export function sortMatchesByKickoff<T extends Pick<ApiMatch, "match_date" | "kickoff_at">>(matches: readonly T[]): T[] {
  return matches
    .map((match, index) => ({ match, index, time: matchKickoffTime(match) }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time - b.time || a.index - b.index;
    })
    .map((entry) => entry.match);
}

/**
 * Home presentation rule, evaluated against `now` (the presentation clock):
 * - `featured`: the earliest match with a valid kickoff that has not passed;
 * - `upcoming`: the next valid, not-yet-passed kickoffs after it, so Home shows
 *   at most `limit` matches in total (featured + up to `limit - 1`);
 * - matches with an unknown kickoff or a passed kickoff are never featured or
 *   listed as upcoming (the full Matches screen still lists them);
 * - `nextBoundary`: when this selection next changes (the featured kickoff),
 *   so the screen can re-evaluate without refetching.
 */
export function selectHomeMatches<T extends ApiMatch>(matches: readonly T[], now: number, limit: number) {
  const future = sortMatchesByKickoff(matches).filter((match) => {
    const time = matchKickoffTime(match);
    return time !== null && time >= now;
  });
  const featured = future[0] ?? null;
  const upcoming = future.slice(1, Math.max(1, limit));
  const nextBoundary = featured ? matchKickoffTime(featured) : null;
  return { featured, upcoming, nextBoundary };
}

export function activeFilterCount(filters: MatchFilters) {
  return [filters.team, filters.stadium, filters.date].filter(Boolean).length;
}

export type MatchListState = "loading" | "error" | "empty" | "filtered-empty" | "results";

/** Distinguishes "nothing scheduled" from "nothing matches these filters". */
export function matchListState({
  loading,
  error,
  count,
  filters,
}: {
  loading: boolean;
  error: string | null;
  count: number;
  filters: MatchFilters;
}): MatchListState {
  if (loading) return "loading";
  if (error && count === 0) return "error";
  if (count > 0) return "results";
  return activeFilterCount(filters) > 0 ? "filtered-empty" : "empty";
}

/**
 * Only statuses the backend actually returns are mapped: `scheduled`,
 * `live` and `completed` (the values `/matches/scheduled?status=` accepts).
 * A blank/missing status is `unknown` (neutral, never assumed to be
 * scheduled); any other value is shown as the backend's own word with a
 * neutral tone — never reinterpreted as live, finished or sold out.
 */
export function matchStatusPresentation(status: string | null | undefined): {
  known: "scheduled" | "live" | "completed" | "unknown" | null;
  tone: StatusTone;
  raw: string;
} {
  const raw = (status ?? "").trim();
  if (raw === "") return { known: "unknown", tone: "neutral", raw: "" };
  const normalized = raw.toLowerCase();
  if (normalized === "scheduled") return { known: "scheduled", tone: "info", raw: "scheduled" };
  if (normalized === "live") return { known: "live", tone: "live", raw: "live" };
  if (normalized === "completed") return { known: "completed", tone: "neutral", raw: "completed" };
  return { known: null, tone: "neutral", raw: raw.replace(/[_-]+/g, " ") };
}

/**
 * The backend score as "home–away", only when BOTH scores are real numbers in
 * the response. Never derived, defaulted to 0, or shown for a partial score.
 */
export function matchScore(match: { home_score?: number | null; away_score?: number | null }): string | null {
  const home = match.home_score;
  const away = match.away_score;
  if (typeof home !== "number" || typeof away !== "number" || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  return `${home}–${away}`;
}

/** Short crest fallback when the backend has no logo: short name, else initials. */
export function teamInitials(team: { name?: string | null; short_name?: string | null } | null | undefined) {
  const short = team?.short_name?.trim();
  if (short) return short.slice(0, 4).toUpperCase();
  const words = (team?.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((word) => word[0]).join("").toUpperCase();
}

// ---- Date-filter calendar helpers (moved unchanged from MatchesList) ----

export function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Sunday-first month grid; `null` cells pad the first and last weeks. */
export function getCalendarDays(month: Date) {
  const first = startOfMonth(month);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push(new Date(month.getFullYear(), month.getMonth(), day));
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

/** "YYYY-MM-DD" value sent as the `date` filter. */
export function toDateInputValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayValue(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function isBeforeDay(left: Date, right: Date) {
  return dayValue(left) < dayValue(right);
}

export function isSameDay(left: Date, right: Date) {
  return dayValue(left) === dayValue(right);
}

/**
 * The next valid kickoff strictly after `now`, or null. This is when a
 * kickoff-based selection (featured / upcoming) can next change.
 */
export function nextKickoffAfter(matches: readonly Pick<ApiMatch, "match_date" | "kickoff_at">[], now: number): number | null {
  let next: number | null = null;
  for (const match of matches) {
    const time = matchKickoffTime(match);
    if (time !== null && time > now && (next === null || time < next)) next = time;
  }
  return next;
}

export type MatchDateGroup<T> = {
  /** The shared backend `match_date` ("YYYY-MM-DD"), or null for fixtures without a valid date. */
  date: string | null;
  matches: T[];
};

/**
 * Groups already-sorted fixtures under the calendar date the backend gave
 * them (presentation only: nothing is filtered out or re-dated). Groups keep
 * the order of their first fixture; fixtures without a valid date are grouped
 * last, never assigned a date.
 */
export function groupMatchesByDate<T extends Pick<ApiMatch, "match_date">>(matches: readonly T[]): MatchDateGroup<T>[] {
  const dated = new Map<string, T[]>();
  const undated: T[] = [];
  for (const match of matches) {
    const parts = parseStrictCalendarDate(match.match_date);
    if (!parts) {
      undated.push(match);
      continue;
    }
    const key = match.match_date.slice(0, 10);
    const group = dated.get(key);
    if (group) group.push(match);
    else dated.set(key, [match]);
  }
  const groups: MatchDateGroup<T>[] = [...dated].map(([date, items]) => ({ date, matches: items }));
  if (undated.length) groups.push({ date: null, matches: undated });
  return groups;
}

/**
 * The compact date strip on Matches: `count` consecutive calendar days from
 * `today`, as the "YYYY-MM-DD" values the backend `date` filter takes. A
 * selected date outside the strip is kept visible (first) so the current
 * filter is never hidden.
 */
export function matchDateStrip(today: Date, count: number, selected?: string, startOffset = 0): string[] {
  const days = Array.from({ length: count }, (_, index) =>
    toDateInputValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() + startOffset + index)),
  );
  if (selected && !days.includes(selected)) return [selected, ...days];
  return days;
}

/**
 * Home "Latest result": the completed fixture with the most recent valid
 * kickoff. Fixtures with an unknown kickoff are used only if no fixture has a
 * known one (never preferred over a dated result).
 */
export function latestCompletedMatch<T extends Pick<ApiMatch, "match_date" | "kickoff_at">>(matches: readonly T[]): T | null {
  const sorted = sortMatchesByKickoff(matches);
  const dated = sorted.filter((match) => matchKickoffTime(match) !== null);
  return dated[dated.length - 1] ?? sorted[0] ?? null;
}

/** The v3 Matches segments. Each maps to one backend `status` query. */
export type MatchTab = "upcoming" | "live" | "results";

export const MATCH_TABS: readonly MatchTab[] = ["upcoming", "live", "results"];

/** `/matches/scheduled` status for a tab: Upcoming is the default list (no status). */
export function statusForTab(tab: MatchTab): MatchFilters["status"] {
  return tab === "live" ? "live" : tab === "results" ? "completed" : undefined;
}

/**
 * The one backend query for the applied filters and tab. Every tab sends an
 * explicitly selected date (the backend accepts `status=live&date=…`); v3 only
 * hides the Live date STRIP, so a Live date comes from the filter sheet.
 */
export function matchQueryFor(filters: MatchFilters, tab: MatchTab): MatchFilters {
  return {
    team: filters.team,
    stadium: filters.stadium,
    date: filters.date,
    status: statusForTab(tab),
  };
}

/**
 * v3 date strips: Upcoming shows today and the next 12 days; Results the 7
 * days before today; Live has none. A selected date outside the strip stays
 * visible (first).
 */
export function dateStripForTab(tab: MatchTab, today: Date, selected?: string): string[] {
  if (tab === "live") return [];
  return tab === "results" ? matchDateStrip(today, 7, selected, -7) : matchDateStrip(today, 13, selected);
}

/** Calendar dates ("YYYY-MM-DD") that have at least one fixture, from real results. */
export function datesWithMatches(matches: readonly Pick<ApiMatch, "match_date">[]): Set<string> {
  const dates = new Set<string>();
  for (const match of matches) {
    if (parseStrictCalendarDate(match.match_date)) dates.add(match.match_date.slice(0, 10));
  }
  return dates;
}

/**
 * Whether the Live-availability probe (`status=live`, no filters) is a
 * DIFFERENT request from the visible query. On an unfiltered Live tab they are
 * identical, so the visible rows answer "is anything live?" and the probe must
 * not request (or force-refresh) the same thing again.
 */
export function needsSeparateLiveProbe(tab: MatchTab, query: MatchFilters) {
  return !(tab === "live" && !query.team && !query.stadium && !query.date);
}
