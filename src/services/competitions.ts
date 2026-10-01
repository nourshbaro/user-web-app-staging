import {
  normalizeCompetitionMatches,
  normalizeCompetitions,
  normalizeStandings,
  type StandingsResult,
} from "@/lib/competitions";
import { ApiError, apiRequest } from "@/services/api";

/**
 * Public competition data (`docs/API_INTEGRATION.md` §14). Requests go
 * through `apiRequest` (maintenance, timeouts, error types). Not user-scoped.
 */
export const competitionsService = {
  async list() {
    return normalizeCompetitions(await apiRequest<unknown>("/competitions"));
  },
  /**
   * The table (rows may be `[]`), or "unavailable" for a 404. Staging returns
   * the same `404 "Endpoint not found."` for cup competitions, unknown ids and
   * wrong routes, with no machine-readable reason, so a 404 is never treated
   * as an empty table. A malformed success, network and server errors reject.
   */
  async standings(id: number): Promise<StandingsResult> {
    let payload: unknown;
    try {
      payload = await apiRequest<unknown>(`/competitions/${encodeURIComponent(String(id))}/standings`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { kind: "unavailable" };
      throw error;
    }
    return { kind: "table", standings: normalizeStandings(payload) };
  },
  async matches(id: number) {
    return normalizeCompetitionMatches(await apiRequest<unknown>(`/competitions/${encodeURIComponent(String(id))}/matches`));
  },
};
