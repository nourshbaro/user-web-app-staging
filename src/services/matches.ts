import { apiRequest, unwrapData } from "@/services/api";
import type { ApiMatch, ApiSeat, FilterOption, MatchFilters } from "@/types";

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
  async list(filters: MatchFilters = {}) {
    const params = new URLSearchParams();
    if (filters.team) params.set("team", filters.team);
    if (filters.stadium) params.set("stadium", filters.stadium);
    if (filters.date) params.set("date", filters.date);
    const query = params.toString();
    const payload = await apiRequest<unknown>(`/matches/scheduled${query ? `?${query}` : ""}`);
    return normalizeMatches(payload);
  },

  async filters() {
    const payload = await apiRequest<{ data: { teams: FilterOption[]; stadiums: FilterOption[] } } | { teams: FilterOption[]; stadiums: FilterOption[] }>("/matches/scheduled/filters");
    const data = "teams" in payload ? payload : payload.data;
    return { teams: data.teams ?? [], stadiums: data.stadiums ?? [] };
  },

  async details(id: string | number) {
    const payload = await apiRequest<ApiMatch | { data: ApiMatch }>(`/matches/single/${id}`);
    return unwrapData(payload);
  },

  async seats(matchId: string | number, zoneId: string | number) {
    const payload = await apiRequest<{ data?: { zone: { id: number; name: string }; seats: ApiSeat[] }; zone?: { id: number; name: string }; seats?: ApiSeat[] }>(`/matches/${matchId}/zones/${zoneId}/seats`);
    const data = payload.data ?? payload;
    return { zone: data.zone, seats: data.seats ?? [] };
  },
};
