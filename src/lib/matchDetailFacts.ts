import type { ApiMatchDetail, ApiMatchEvent, ApiStatPair } from "@/types";

/**
 * Display facts from `GET /matches/single/{id}`. Pure module (no React Native
 * imports). Every value is the backend's own; anything absent or null stays
 * null. Nothing is defaulted to zero or invented: a null clock minute is not
 * a live minute, empty events are no timeline, a null score side is not 0,
 * and a null statistic is "not supplied", never 0. There is no client-side
 * match clock.
 */

export type MatchStatKey = "possession" | "shots" | "shots_on_target" | "corners" | "fouls";

export const MATCH_STAT_KEYS: readonly MatchStatKey[] = ["possession", "shots", "shots_on_target", "corners", "fouls"];

export type MatchSide = "home" | "away";

/**
 * The backend event types the app gives meaning to — exact strings only
 * (admin event contract `MATCH_EVENT_TYPES`; staging `/matches/single/17`).
 * Any other type is a neutral event: never inferred from players or text.
 */
export type TimelineKind = "goal" | "yellow_card" | "red_card" | "substitution" | "other";

const KNOWN_EVENT_KINDS: readonly TimelineKind[] = ["goal", "yellow_card", "red_card", "substitution"];

export function timelineKind(type: unknown): TimelineKind {
  return KNOWN_EVENT_KINDS.find((kind) => kind === type) ?? "other";
}

export type TimelineRow = {
  key: string;
  /** The backend `type` when it is a known kind; anything else is "other" (neutral). */
  kind: TimelineKind;
  /** The team the backend attached, matched to home/away by id; null when it matches neither. */
  side: MatchSide | null;
  /** "1'", "45+2'", or null when the backend sent no minute. */
  minuteLabel: string | null;
  player: string | null;
  shirtNumber: number | null;
  teamName: string | null;
  /** Substitutions only, from `player_in` / `player_out`; null when not supplied. */
  playerIn: string | null;
  playerOut: string | null;
};

export type StatRow = {
  key: MatchStatKey;
  home: number | null;
  away: number | null;
  unit: "%" | "";
  /** Bar shares (0–100) only when both sides are supplied and their sum is positive. */
  homeShare: number | null;
  awayShare: number | null;
};

export type MatchDetailFacts = {
  competitionName: string | null;
  competitionLogo: string | null;
  seasonLabel: string | null;
  /** `matchday_label`, else `round_name`; never composed from a bare number. */
  roundLabel: string | null;
  /** Each backend score side on its own; null stays null. */
  homeScore: number | null;
  awayScore: number | null;
  /** Both backend scores, or null. */
  score: { home: number; away: number } | null;
  /** The backend live minute, or null (e.g. `clock.minute: null`). */
  liveMinute: number | null;
  clockRunning: boolean | null;
  /** Backend events as given (an empty or missing list is an empty array). */
  events: ApiMatchEvent[];
  /** Only statistics with at least one supplied side. */
  stats: { key: MatchStatKey; home: number | null; away: number | null }[];
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function statPair(value: ApiStatPair | undefined) {
  if (!value || typeof value !== "object") return null;
  const home = finite(value.home);
  const away = finite(value.away);
  return home === null && away === null ? null : { home, away };
}

export function matchDetailFacts(match: ApiMatchDetail): MatchDetailFacts {
  const home = finite(match.home_score);
  const away = finite(match.away_score);
  const stats = match.stats && typeof match.stats === "object" ? match.stats : null;
  return {
    competitionName: text(match.competition?.name),
    competitionLogo: text(match.competition?.logo),
    seasonLabel: text(match.season?.label),
    roundLabel: text(match.matchday_label) ?? text(match.round_name),
    homeScore: home,
    awayScore: away,
    score: home !== null && away !== null ? { home, away } : null,
    liveMinute: finite(match.clock?.minute),
    clockRunning: typeof match.clock?.running === "boolean" ? match.clock.running : null,
    events: Array.isArray(match.events) ? match.events.filter((event) => event && typeof event === "object") : [],
    stats: stats
      ? MATCH_STAT_KEYS.flatMap((key) => {
          const pair = statPair(stats[key]);
          return pair ? [{ key, ...pair }] : [];
        })
      : [],
  };
}

/** "1'" for minute 1; "45+2'" with an extra minute; null without a backend minute. */
export function formatEventMinute(minute: unknown, extraMinute: unknown) {
  const base = finite(minute);
  if (base === null) return null;
  const extra = finite(extraMinute);
  return extra !== null && extra > 0 ? `${base}+${extra}'` : `${base}'`;
}

/**
 * Timeline rows in match order (minute, then extra minute; events without a
 * minute keep their backend order at the end). Nothing is inferred: the side
 * comes only from the event's team id, and unknown types carry no meaning.
 */
export function timelineRows(match: ApiMatchDetail): TimelineRow[] {
  const homeId = match.home_team?.id;
  const awayId = match.away_team?.id;
  const rows = matchDetailFacts(match).events.map((event, index) => {
    const teamId = event.team?.id;
    const side: MatchSide | null =
      teamId !== undefined && teamId === homeId ? "home" : teamId !== undefined && teamId === awayId ? "away" : null;
    const kind = timelineKind(event.type);
    const substitution = kind === "substitution";
    return {
      order: index,
      minute: finite(event.minute),
      extra: finite(event.extra_minute) ?? 0,
      row: {
        key: `${event.id ?? "event"}-${index}`,
        kind,
        side,
        minuteLabel: formatEventMinute(event.minute, event.extra_minute),
        player: text(event.player?.name),
        shirtNumber: finite(event.player?.shirt_number),
        teamName: text(event.team?.name),
        playerIn: substitution ? text(event.player_in?.name) : null,
        playerOut: substitution ? text(event.player_out?.name) : null,
      },
    };
  });
  rows.sort((a, b) => {
    if (a.minute === null && b.minute === null) return a.order - b.order;
    if (a.minute === null) return 1;
    if (b.minute === null) return -1;
    return a.minute - b.minute || a.extra - b.extra || a.order - b.order;
  });
  return rows.map((item) => item.row);
}

/** v3 scorer lines under the score: "Player 1'" per goal, by side. Only goals with a named player. */
export function scorerLines(rows: readonly TimelineRow[]) {
  const line = (row: TimelineRow) => [row.player, row.minuteLabel].filter(Boolean).join(" ");
  const goals = rows.filter((row) => row.kind === "goal" && row.player);
  return {
    home: goals.filter((row) => row.side === "home").map(line),
    away: goals.filter((row) => row.side === "away").map(line),
  };
}

/** Statistic rows with v3 bar shares derived from the two real values only. */
export function statRows(match: ApiMatchDetail): StatRow[] {
  return matchDetailFacts(match).stats.map((stat) => {
    const both = stat.home !== null && stat.away !== null;
    const total = both ? (stat.home as number) + (stat.away as number) : 0;
    return {
      ...stat,
      unit: stat.key === "possession" ? "%" : "",
      homeShare: both && total > 0 ? Math.round(((stat.home as number) / total) * 100) : null,
      awayShare: both && total > 0 ? Math.round(((stat.away as number) / total) * 100) : null,
    };
  });
}
