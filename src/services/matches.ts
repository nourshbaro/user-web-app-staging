import { createQueryCache, type CachePolicy } from "@/lib/queryCache";
import { apiRequest, unwrapData } from "@/services/api";
import type { ApiMatch, ApiMatchDetail, ApiSeat, FilterOption, MatchFilters } from "@/types";

const MINUTE = 60 * 1000;

/**
 * Public match data (not user-scoped). Freshness by resource:
 * - scheduled / completed lists and non-live details: 5 min (the previous TTL);
 * - the live list and live match details: 30 s fresh (the Live tab polling
 *   period) and shown while revalidating for at most 2 min, because scores,
 *   clocks and status change during play;
 * - seat availability: 30 s; the backend cart add stays the final authority;
 * - filter options (teams / stadiums): 30 min.
 * `maxStaleMs` bounds how old an entry may be when shown while it revalidates.
 */
export const MATCH_POLICIES = {
  list: { freshMs: 5 * MINUTE, maxStaleMs: 30 * MINUTE },
  liveList: { freshMs: 30 * 1000, maxStaleMs: 2 * MINUTE },
  filters: { freshMs: 30 * MINUTE, maxStaleMs: 2 * 60 * MINUTE },
  detail: { freshMs: 5 * MINUTE, maxStaleMs: 30 * MINUTE },
  liveDetail: { freshMs: 30 * 1000, maxStaleMs: 2 * MINUTE },
  seats: { freshMs: 30 * 1000, maxStaleMs: 30 * 1000 },
} satisfies Record<string, CachePolicy>;

/** Matches that entered (kickoff) or left (full time, or any other end of play) the live set. */
export type LiveTransition = { entered: string[]; left: string[] };

const cache = createQueryCache();
let liveIds: string[] | null = null;
const transitionListeners = new Set<(transition: LiveTransition) => void>();

/**
 * Subscribe to accepted live-set changes. Owners of data that a match
 * entering or leaving play makes obsolete (mounted match lists, competition
 * matches / standings) use it to drop and re-read their data; nothing polls.
 */
export function onLiveTransition(listener: (transition: LiveTransition) => void) {
  transitionListeners.add(listener);
  return () => {
    transitionListeners.delete(listener);
  };
}

function normalizeMatches(payload: unknown): ApiMatch[] {
  const data = unwrapData(payload as ApiMatch[] | { data: unknown });
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const record = data as { matches?: unknown; scheduled_matches?: unknown; items?: unknown };
    if (Array.isArray(record.matches)) return record.matches as ApiMatch[];
    if (Array.isArray(record.scheduled_matches)) return record.scheduled_matches as ApiMatch[];
    if (Array.isArray(record.items)) return record.items as ApiMatch[];
  }
  return [];
}

export function matchListPath(filters: MatchFilters = {}) {
  const params = new URLSearchParams();
  if (filters.team) params.set("team", filters.team);
  if (filters.stadium) params.set("stadium", filters.stadium);
  if (filters.date) params.set("date", filters.date);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return `/matches/scheduled${query ? `?${query}` : ""}`;
}

function listPolicy(filters: MatchFilters) {
  return filters.status === "live" ? MATCH_POLICIES.liveList : MATCH_POLICIES.list;
}

/** A cached live match keeps the live window (fresh and stale); any other detail the normal one. */
function detailPolicy(path: string) {
  return cache.peek<ApiMatchDetail>(path, MATCH_POLICIES.detail)?.value.status === "live" ? MATCH_POLICIES.liveDetail : MATCH_POLICIES.detail;
}

const UNFILTERED_LIVE_PATH = matchListPath({ status: "live" });

/**
 * Runs only for an ACCEPTED unfiltered live answer (the cache's `onAccept`),
 * so a superseded, slower response can neither move the live set nor
 * invalidate anything. When a match entered or left play, every other match
 * list (scheduled, completed, filtered — including filtered live lists) and
 * those matches' details are dropped, then subscribers are told.
 */
function acceptLiveMatches(matches: ApiMatch[]) {
  const ids = [...new Set(matches.map((match) => String(match.id)))];
  const previous = liveIds;
  liveIds = ids;
  if (previous === null) return;
  const before = new Set(previous);
  const after = new Set(ids);
  const transition: LiveTransition = {
    entered: ids.filter((id) => !before.has(id)),
    left: previous.filter((id) => !after.has(id)),
  };
  if (!transition.entered.length && !transition.left.length) return;
  cache.invalidate((key) => key.startsWith("/matches/scheduled") && key !== "/matches/scheduled/filters" && key !== UNFILTERED_LIVE_PATH);
  const changed = new Set([...transition.entered, ...transition.left]);
  cache.invalidate((key) => changed.has(key.slice("/matches/single/".length)) && key.startsWith("/matches/single/"));
  transitionListeners.forEach((listener) => listener(transition));
}

export const matchesService = {
  async list(filters: MatchFilters = {}, force = false) {
    const path = matchListPath(filters);
    return cache.read(path, listPolicy(filters), async () => normalizeMatches(await apiRequest<unknown>(path)), {
      force,
      onAccept: path === UNFILTERED_LIVE_PATH ? acceptLiveMatches : undefined,
    });
  },

  /** Cached list (possibly stale, never older than its policy's `maxStaleMs`) for an immediate render. */
  peekList(filters: MatchFilters = {}) {
    return cache.peek<ApiMatch[]>(matchListPath(filters), listPolicy(filters));
  },

  async filters(force = false) {
    return cache.read("/matches/scheduled/filters", MATCH_POLICIES.filters, async () => {
      const payload = await apiRequest<{ data: { teams: FilterOption[]; stadiums: FilterOption[] } } | { teams: FilterOption[]; stadiums: FilterOption[] }>("/matches/scheduled/filters");
      const data = "teams" in payload ? payload : payload.data;
      return { teams: data.teams ?? [], stadiums: data.stadiums ?? [] };
    }, { force });
  },

  peekFilters() {
    return cache.peek<{ teams: FilterOption[]; stadiums: FilterOption[] }>("/matches/scheduled/filters", MATCH_POLICIES.filters);
  },

  async details(id: string | number, force = false) {
    const path = `/matches/single/${id}`;
    return cache.read(path, detailPolicy(path), async () => unwrapData(await apiRequest<ApiMatchDetail | { data: ApiMatchDetail }>(path)), { force });
  },

  async seats(matchId: string | number, zoneId: string | number, force = false) {
    const path = `/matches/${matchId}/zones/${zoneId}/seats`;
    return cache.read(path, MATCH_POLICIES.seats, async () => {
      const payload = await apiRequest<{ data?: { zone: { id: number; name: string }; seats: ApiSeat[] }; zone?: { id: number; name: string }; seats?: ApiSeat[] }>(path);
      const data = payload.data ?? payload;
      return { zone: data.zone, seats: data.seats ?? [] };
    }, { force });
  },
};
