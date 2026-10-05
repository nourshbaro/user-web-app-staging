import {
  applyQueryFailure,
  applyQuerySuccess,
  emptyMatchQuerySnapshot,
  matchQueryView,
  type MatchQuerySnapshot,
} from "@/lib/matchQuery";
import type { RevalidationReason } from "@/lib/liveRevalidation";
import { createRequestAuthority, createRequestIdentity } from "@/lib/requestAuthority";
import { userFacingError } from "@/lib/userFacingError";
import { matchesService, onLiveTransition } from "@/services/matches";
import type { ApiMatch, FilterOption, MatchFilters } from "@/types";
import { useCallback, useEffect, useMemo, useState } from "react";

type FilterOptions = { teams: FilterOption[]; stadiums: FilterOption[] };

const EMPTY_FILTER_OPTIONS: FilterOptions = { teams: [], stadiums: [] };

function requestFiltersOf(filters: MatchFilters): MatchFilters {
  return { team: filters.team, stadium: filters.stadium, date: filters.date, status: filters.status };
}

export function matchFilterIdentity(filters: MatchFilters) {
  return createRequestIdentity([filters.team, filters.stadium, filters.date, filters.status]);
}

/**
 * Screen-level owner of scheduled-match loading for Home and Matches.
 *
 * Same `matchesService` calls and the same request authority as before. A
 * cached list (within its policy) renders immediately, including on the first
 * render after a remount; the service then decides whether a request is
 * needed. Results and errors are tagged with the filter identity
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
  // Seeded from the service cache so a revisited screen shows its rows on the first frame.
  const [initial] = useState(() => (enabled ? matchesService.peekList(requestFiltersOf(filters)) : null));
  const [snapshot, setSnapshot] = useState<MatchQuerySnapshot<ApiMatch>>(() =>
    initial ? applyQuerySuccess(matchFilterIdentity(filters), initial.value) : emptyMatchQuerySnapshot(),
  );
  /** When the current items were received; screens compare kickoffs without reading the clock during render. */
  const [loadedAt, setLoadedAt] = useState(() => initial?.fetchedAt ?? 0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(() =>
    (withFilterOptions ? matchesService.peekFilters()?.value : null) ?? EMPTY_FILTER_OPTIONS,
  );
  const [loadingFlag, setLoadingFlag] = useState(initial === null);
  const [refreshing, setRefreshing] = useState(false);
  const requestAuthority = useMemo(() => createRequestAuthority(), []);
  const filterIdentity = matchFilterIdentity(filters);

  /**
   * `load`: initial / retry (cached rows at once, else the loading state);
   * `refresh`: pull-to-refresh, forced; `poll`: a forced background read;
   * `revalidate`: a background read the service may answer from fresh data.
   * Background modes never touch the loading or refreshing state.
   */
  const load = useCallback(async (mode: "load" | "refresh" | "poll" | "revalidate" = "load") => {
    const forceRefresh = mode === "refresh" || mode === "poll";
    const requestFilters = { team: filters.team, stadium: filters.stadium, date: filters.date, status: filters.status };
    const identity = matchFilterIdentity(requestFilters);
    const ticket = requestAuthority.begin(identity);
    if (mode === "load") {
      // A cached list for these filters is shown at once (no skeleton) while
      // the service serves it or revalidates it; otherwise the usual loading state.
      const cached = matchesService.peekList(requestFilters);
      if (cached) {
        setSnapshot(applyQuerySuccess(identity, cached.value));
        setLoadedAt(cached.fetchedAt);
        setLoadingFlag(false);
      } else {
        setLoadingFlag(true);
      }
    }
    try {
      const [nextMatches, nextFilters] = await Promise.all([
        matchesService.list(requestFilters, forceRefresh),
        // Teams / stadiums are slow-changing: only pull-to-refresh forces them (never a Live poll).
        withFilterOptions ? matchesService.filters(mode === "refresh") : Promise.resolve(null),
      ]);
      if (!requestAuthority.isCurrent(ticket)) return;
      setSnapshot(applyQuerySuccess(identity, nextMatches));
      setLoadedAt(matchesService.peekList(requestFilters)?.fetchedAt ?? Date.now());
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
    void load("refresh");
  }, [enabled, load]);

  /** Retry after an error: a normal (non-forced) load through the same service path. */
  const retry = useCallback(() => void load(), [load]);

  /**
   * Background revalidation through the same authority and snapshot rules,
   * with no loading or pull-to-refresh indicator, so existing rows never
   * flicker. A Live `interval` tick always reaches the backend; a `focus` /
   * `foreground` re-read is answered by the cache while the list is within
   * its freshness (30 s for live lists). A failure keeps the rows and surfaces
   * the usual retry.
   */
  const revalidate = useCallback((reason: RevalidationReason = "interval") => {
    if (enabled) void load(reason === "interval" ? "poll" : "revalidate");
  }, [enabled, load]);

  // A match entered or left play: the service has dropped the affected lists,
  // so a mounted screen re-reads them in the background instead of keeping an
  // obsolete snapshot (the live list that just answered is served fresh).
  useEffect(() => {
    if (!enabled) return;
    return onLiveTransition(() => void load("revalidate"));
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
