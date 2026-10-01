/**
 * Competitions: response normalization and presentation rules. Pure module
 * (no React Native imports). Shapes are the confirmed contracts
 * (`docs/API_INTEGRATION.md` §14); nothing is filled in or invented.
 */

export type CompetitionSummary = {
  id: number;
  name: string;
  shortName: string | null;
  slug: string | null;
  /** Backend media path (resolve with `storageUrl`). */
  logo: string | null;
  /** e.g. "league" / "cup" as sent by the backend. */
  format: string | null;
};

export type StandingTeam = { id: number; name: string; short_name: string | null; logo: string | null };

export type StandingRow = {
  rank: number;
  team: StandingTeam;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type CompetitionStandings = {
  competition: { id: number; name: string; shortName: string | null } | null;
  season: { id: number; label: string; isCurrent: boolean } | null;
  rows: StandingRow[];
};

export type CompetitionMatchTeam = { id: number; name: string; short_name?: string | null; logo?: string | null };

/** `GET /competitions/{id}/matches` item (scores nullable, stadium with location). */
export type CompetitionMatch = {
  id: number;
  match_date: string;
  kickoff_at: string;
  status: string;
  matchday: number | null;
  round_name: string | null;
  matchday_label: string | null;
  home_team: CompetitionMatchTeam;
  away_team: CompetitionMatchTeam;
  home_score: number | null;
  away_score: number | null;
  stadium: { id: number; name: string; location?: string } | undefined;
};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dataOf(payload: unknown): unknown {
  return isRecord(payload) && "data" in payload ? payload.data : payload;
}

/** `GET /competitions` → valid competitions only (id + name required). */
export function normalizeCompetitions(payload: unknown): CompetitionSummary[] {
  const data = dataOf(payload);
  if (!Array.isArray(data)) throw new Error("Invalid competitions response");
  return data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = integer(item.id);
    const name = text(item.name);
    if (id === null || !name) return [];
    return [{ id, name, shortName: text(item.short_name), slug: text(item.slug), logo: text(item.logo), format: text(item.format) }];
  });
}

function standingTeam(value: unknown): StandingTeam | null {
  if (!isRecord(value)) return null;
  const id = integer(value.id);
  const name = text(value.name);
  if (id === null || !name) return null;
  return { id, name, short_name: text(value.short_name), logo: text(value.logo) };
}

/**
 * `GET /competitions/{id}/standings` → table rows. `standings` must be an
 * array (`[]` is a genuine "no standings"). A missing / non-array
 * `standings`, or any row missing a required field, rejects the response as
 * malformed: a table with silently dropped teams (or invented zeros) would be
 * a wrong table, and a malformed payload is not an empty one.
 */
export function normalizeStandings(payload: unknown): CompetitionStandings {
  const data = dataOf(payload);
  if (!isRecord(data)) throw new Error("Invalid standings response");
  const competition = isRecord(data.competition) && integer(data.competition.id) !== null && text(data.competition.name)
    ? { id: data.competition.id as number, name: text(data.competition.name) as string, shortName: text(data.competition.short_name) }
    : null;
  const season = isRecord(data.season) && integer(data.season.id) !== null && text(data.season.label)
    ? { id: data.season.id as number, label: text(data.season.label) as string, isCurrent: data.season.is_current === true }
    : null;
  if (!Array.isArray(data.standings)) throw new Error("Invalid standings response");
  const rows = data.standings.map((row): StandingRow => {
    if (!isRecord(row)) throw new Error("Invalid standings row");
    const team = standingTeam(row.team);
    const numbers = [row.rank, row.played, row.won, row.drawn, row.lost, row.goals_for, row.goals_against, row.goal_difference, row.points].map(integer);
    if (!team || numbers.some((value) => value === null)) throw new Error("Invalid standings row");
    const [rank, played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points] = numbers as number[];
    return { rank, team, played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points };
  });
  rows.sort((a, b) => a.rank - b.rank);
  return { competition, season, rows };
}

function matchTeam(value: unknown): CompetitionMatchTeam | null {
  if (!isRecord(value)) return null;
  const id = integer(value.id);
  const name = text(value.name);
  if (id === null || !name) return null;
  return { id, name, short_name: text(value.short_name), logo: text(value.logo) };
}

/** `GET /competitions/{id}/matches` → valid matches; scores stay nullable. */
export function normalizeCompetitionMatches(payload: unknown): CompetitionMatch[] {
  const data = dataOf(payload);
  if (!Array.isArray(data)) throw new Error("Invalid competition matches response");
  return data.flatMap((item): CompetitionMatch[] => {
    if (!isRecord(item)) return [];
    const id = integer(item.id);
    const home = matchTeam(item.home_team);
    const away = matchTeam(item.away_team);
    const status = text(item.status);
    if (id === null || !home || !away || !status || typeof item.match_date !== "string" || typeof item.kickoff_at !== "string") return [];
    const stadium = isRecord(item.stadium) && integer(item.stadium.id) !== null && text(item.stadium.name)
      ? { id: item.stadium.id as number, name: text(item.stadium.name) as string, ...(text(item.stadium.location) ? { location: text(item.stadium.location) as string } : {}) }
      : undefined;
    return [{
      id,
      match_date: item.match_date,
      kickoff_at: item.kickoff_at,
      status,
      matchday: integer(item.matchday),
      round_name: text(item.round_name),
      matchday_label: text(item.matchday_label),
      home_team: home,
      away_team: away,
      home_score: finiteOrNull(item.home_score),
      away_score: finiteOrNull(item.away_score),
      stadium,
    }];
  });
}

/** "+3", "0", "-2" — the backend goal difference, signed for reading. */
export function formatGoalDifference(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Every competition match opens the one Match Details route; that screen's
 * backend status decides purchase (scheduled) vs live/result. Competitions
 * never decides purchasability itself.
 */
export function competitionMatchRoute(match: { id: number }) {
  return { pathname: "/match/[id]" as const, params: { id: String(match.id) } };
}

/**
 * A standings request outcome. `table` is a successful response (its rows
 * may be `[]`). `unavailable` is a 404: staging answers a cup competition,
 * an unknown competition id and a wrong route with the same
 * `404 {"message":"Endpoint not found."}`, so a 404 is never read as
 * "no standings" — it is an honest, retryable "unavailable".
 */
export type StandingsResult = { kind: "table"; standings: CompetitionStandings } | { kind: "unavailable" };

export type StandingsView = "loading" | "error" | "unavailable" | "none" | "table";

/** Standings state: only a successful `standings: []` is "none"; a 404 is "unavailable"; failures are "error". */
export function standingsView(input: { loading: boolean; error: boolean; standings: StandingsResult | null }): StandingsView {
  if (input.loading) return "loading";
  if (input.error || !input.standings) return "error";
  if (input.standings.kind === "unavailable") return "unavailable";
  return input.standings.standings.rows.length === 0 ? "none" : "table";
}
