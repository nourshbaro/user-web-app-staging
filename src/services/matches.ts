import { apiRequest, unwrapData } from "@/services/api";
import type { ApiMatch, ApiSeat, FilterOption, MatchFilters } from "@/types";

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cached<T>(key: string, request: () => Promise<T>, force = false): Promise<T> {
  const entry = cache.get(key);
  if (!force && entry && entry.expiresAt > Date.now()) return entry.value as T;
  const value = await request();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
  return value;
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

export const matchesService = {
  async list(filters: MatchFilters = {}, force = false) {
    const params = new URLSearchParams();
    if (filters.team) params.set("team", filters.team);
    if (filters.stadium) params.set("stadium", filters.stadium);
    if (filters.date) params.set("date", filters.date);
    const query = params.toString();
    const path = `/matches/scheduled${query ? `?${query}` : ""}`;
    return cached(path, async () => normalizeMatches(await apiRequest<unknown>(path)), force);
  },

  async filters(force = false) {
    return cached("/matches/scheduled/filters", async () => {
      const payload = await apiRequest<{ data: { teams: FilterOption[]; stadiums: FilterOption[] } } | { teams: FilterOption[]; stadiums: FilterOption[] }>("/matches/scheduled/filters");
      const data = "teams" in payload ? payload : payload.data;
      return { teams: data.teams ?? [], stadiums: data.stadiums ?? [] };
    }, force);
  },

  async details(id: string | number, force = false) {
    const path = `/matches/single/${id}`;
    return cached(path, async () => unwrapData(await apiRequest<ApiMatch | { data: ApiMatch }>(path)), force);
  },

  async seats(matchId: string | number, zoneId: string | number, force = false) {
    const path = `/matches/${matchId}/zones/${zoneId}/seats`;
    return cached(path, async () => {
      const payload = await apiRequest<{ data?: { zone: { id: number; name: string }; seats: ApiSeat[] }; zone?: { id: number; name: string }; seats?: ApiSeat[] }>(path);
      const data = payload.data ?? payload;
      return { zone: data.zone, seats: data.seats ?? [] };
    }, force);
  },
};
