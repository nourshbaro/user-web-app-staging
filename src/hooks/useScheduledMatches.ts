import {
  applyQueryFailure,
  applyQuerySuccess,
  emptyMatchQuerySnapshot,
  matchQueryView,
  type MatchQuerySnapshot,
} from "@/lib/matchQuery";
import { createRequestAuthority, createRequestIdentity } from "@/lib/requestAuthority";
import { userFacingError } from "@/lib/userFacingError";
import { matchesService } from "@/services/matches";
import type { ApiMatch, FilterOption, MatchFilters } from "@/types";
import { useCallback, useEffect, useMemo, useState } from "react";

type FilterOptions = { teams: FilterOption[]; stadiums: FilterOption[] };

export function matchFilterIdentity(filters: MatchFilters) {
  return createRequestIdentity([filters.team, filters.stadium, filters.date, filters.status]);
}

/**
 * Screen-level owner of scheduled-match loading for Home and Matches.
 *
 * Same `matchesService` calls (and its 5-minute cache) and the same request
 * authority as before. Results and errors are tagged with the filter identity
 * that produced them (`matchQuery.ts`), and only data for the CURRENT
 * selection is returned, so earlier results are never shown under newer
 * filters. No second cache or store is introduced.
 */
export function useScheduledMatches(
  filters: MatchFilters,
  {
    withFilterOptions = false,
    /** `false`: this instance loads nothing (e.g. a probe whose answer another query already provides). */
    enabled = true,
  }: { withFilterOptions?: boolean; enabled?: boolean } = {},
) {
  const [snapshot, setSnapshot] = useState<MatchQuerySnapshot<ApiMatch>>(emptyMatchQuerySnapshot);
  /** When the current items were received; screens compare kickoffs without reading the clock during render. */
  const [loadedAt, setLoadedAt] = useState(0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ teams: [], stadiums: [] });
  const [loadingFlag, setLoadingFlag] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestAuthority = useMemo(() => createRequestAuthority(), []);
  const filterIdentity = matchFilterIdentity(filters);

  const load = useCallback(async (forceRefresh = false) => {
    const requestFilters = { team: filters.team, stadium: filters.stadium, date: filters.date, status: filters.status };
    const identity = matchFilterIdentity(requestFilters);
    const ticket = requestAuthority.begin(identity);
    if (!forceRefresh) setLoadingFlag(true);
    try {
      const [nextMatches, nextFilters] = await Promise.all([
        matchesService.list(requestFilters, forceRefresh),
        withFilterOptions ? matchesService.filters(forceRefresh) : Promise.resolve(null),
      ]);
      if (!requestAuthority.isCurrent(ticket)) return;
      setSnapshot(applyQuerySuccess(identity, nextMatches));
      setLoadedAt(Date.now());
      if (nextFilters) setFilterOptions(nextFilters);
    } catch (err) {
      if (!requestAuthority.isCurrent(ticket)) return;
      const message = userFacingError(err, "Could not load matches. Please try again.");
      setSnapshot((current) => applyQueryFailure(current, identity, message));
    } finally {
      if (requestAuthority.isCurrent(ticket)) {
        setLoadingFlag(false);
        setRefreshing(false);
      }
    }
  }, [filters.date, filters.stadium, filters.status, filters.team, requestAuthority, withFilterOptions]);

  useEffect(() => {
    requestAuthority.mount();
    return () => requestAuthority.unmount();
  }, [requestAuthority]);

  useEffect(() => {
    if (!enabled) return;
    const timeout = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(timeout);
      requestAuthority.invalidate(filterIdentity);
    };
  }, [enabled, filterIdentity, load, requestAuthority]);

  /**
   * Synchronously voids any in-flight request before the caller switches to
   * `nextFilters`, so a late response for the old filters cannot publish.
   */
  const invalidate = useCallback((nextFilters: MatchFilters) => {
    requestAuthority.invalidate(matchFilterIdentity(nextFilters));
  }, [requestAuthority]);

  const refresh = useCallback(() => {
    // A disabled instance never requests (it would duplicate the query that answers for it).
    if (!enabled) return;
    setRefreshing(true);
    void load(true);
  }, [enabled, load]);

  /** Retry after an error: a normal (non-forced) load through the same service path. */
  const retry = useCallback(() => void load(), [load]);

  /**
   * Background revalidation (focus, foreground, the Live interval): a forced
   * reload through the same authority and snapshot rules, with no loading or
   * pull-to-refresh indicator, so existing rows never flicker. A failure keeps
   * the rows and surfaces the usual retry.
   */
  const revalidate = useCallback(() => {
    if (enabled) void load(true);
  }, [enabled, load]);

  const view = matchQueryView(snapshot, filterIdentity);
  // Nothing (neither results nor an error) yet for this selection = still loading.
  const loading = loadingFlag || (!view.hasItemsForSelection && view.error === null);

  if (!enabled) {
    return { matches: [] as ApiMatch[], loadedAt: 0, filterOptions, loading: false, refreshing: false, error: null, refresh, retry, invalidate, revalidate };
  }

  return {
    matches: view.items,
    loadedAt,
    filterOptions,
    loading,
    refreshing,
    error: view.error,
    refresh,
    retry,
    invalidate,
    revalidate,
  };
}
