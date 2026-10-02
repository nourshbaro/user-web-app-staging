import { StatePanel } from "@/components/foundation";
import { MatchCard } from "@/components/match/MatchCard";
import { MatchDateStrip, MatchFilterBar, MatchFiltersSheet, MatchTabs, type MatchFilterSelection } from "@/components/match/MatchFilters";
import { MatchGroup } from "@/components/match/MatchGroup";
import { MatchListSkeleton } from "@/components/match/MatchSkeletons";
import { TabHeader } from "@/components/TabHeader";
import { useLiveRevalidation } from "@/hooks/useLiveRevalidation";
import { matchFilterIdentity, useScheduledMatches } from "@/hooks/useScheduledMatches";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";
import { spacing } from "@/lib/designTokens";
import { formatCalendarDate, formatLongCalendarDate } from "@/lib/format";
import {
  datesWithMatches,
  groupMatchesByDate,
  matchListState,
  matchQueryFor,
  matchTabFromParam,
  needsSeparateLiveProbe,
  sortMatchesByKickoff,
  type MatchTab,
} from "@/lib/matchDiscovery";
import type { ApiMatch, FilterOption, MatchFilters } from "@/types";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

export function openMatch(match: ApiMatch) {
  router.push({ pathname: "/match/[id]", params: { id: String(match.id) } });
}

const LIVE_PROBE: MatchFilters = { status: "live" };
const NO_REVALIDATION = () => {};

const EMPTY_COPY: Record<MatchTab, { title: MessageKey; message: MessageKey }> = {
  upcoming: { title: "matches.empty.title", message: "matches.empty.message" },
  live: { title: "matches.live.empty.title", message: "matches.live.empty.message" },
  results: { title: "matches.results.empty.title", message: "matches.results.empty.message" },
};

function optionName(options: FilterOption[], slug?: string) {
  return slug ? options.find((option) => option.slug === slug)?.name ?? slug : undefined;
}

/**
 * Matches (LFA Screen v3). Owns the applied filters and the Upcoming / Live /
 * Results tab; loading goes through `useScheduledMatches` (the existing
 * service, cache and request authority) with ONE backend query:
 * `/matches/scheduled` with `status` omitted (Upcoming), `live` or `completed`,
 * composed server-side with team, stadium and date. Nothing is filtered or
 * fabricated on the device.
 */
export function MatchesList() {
  const { t, plural } = useI18n();
  const [filters, setFilters] = useState<MatchFilters>({});
  // Home "See all" opens Live / Results directly (`/matches?tab=…`); validated, default Upcoming.
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const [tab, setTab] = useState<MatchTab>(() => matchTabFromParam(params.tab));
  const [sheetOpen, setSheetOpen] = useState(false);
  // New key per opening, so the sheet's draft always starts from the applied selection.
  const [sheetKey, setSheetKey] = useState(0);
  const query = useMemo(() => matchQueryFor(filters, tab), [filters, tab]);
  const data = useScheduledMatches(query, { withFilterOptions: true });
  const liveSelected = tab === "live";
  // The Live segment's dot: only when the backend reports live matches. On an
  // unfiltered Live tab the visible query IS that question, so the probe is
  // disabled (no second identical request) and the dot reads the visible rows.
  const liveProbeNeeded = needsSeparateLiveProbe(tab, query);
  const liveProbe = useScheduledMatches(LIVE_PROBE, { enabled: liveProbeNeeded });
  const matches = useMemo(() => sortMatchesByKickoff(data.matches), [data.matches]);
  const liveAvailable = liveProbeNeeded ? liveProbe.matches.length > 0 : matches.length > 0;
  // Bounded Live freshness: the visible Live query re-reads on focus/foreground
  // and every 30s while the Live tab is on screen; the dot probe on focus/foreground.
  // Upcoming and Results are not revalidated or polled.
  useLiveRevalidation(liveSelected ? data.revalidate : NO_REVALIDATION, { poll: liveSelected });
  useLiveRevalidation(liveProbe.revalidate);
  const groups = useMemo(() => groupMatchesByDate(matches), [matches]);
  const state = matchListState({ loading: data.loading, error: data.error, count: matches.length, filters: query });

  // Date-chip dots come from the tab's undated results; while a date is
  // selected the last undated result for the same tab/team/stadium is kept.
  const dotKey = matchFilterIdentity({ ...query, date: undefined });
  const [dotCache, setDotCache] = useState<{ key: string; dates: Set<string> }>({ key: "", dates: new Set() });
  if (!query.date && !data.loading && !data.error && dotCache.key !== `${dotKey}|${data.loadedAt}`) {
    setDotCache({ key: `${dotKey}|${data.loadedAt}`, dates: datesWithMatches(data.matches) });
  }
  const dotDates = dotCache.key.startsWith(`${dotKey}|`) ? dotCache.dates : new Set<string>();

  const { invalidate } = data;
  // Every change voids the in-flight request synchronously, before state changes.
  const changeSelection = useCallback((next: MatchFilterSelection) => {
    invalidate(matchQueryFor(next.filters, next.tab));
    setFilters(next.filters);
    setTab(next.tab);
  }, [invalidate]);
  const changeFilters = useCallback((next: MatchFilters) => changeSelection({ filters: next, tab }), [changeSelection, tab]);
  const clearFilters = useCallback(() => changeFilters({}), [changeFilters]);

  const summary = [
    plural("matches.count", matches.length),
    optionName(data.filterOptions.teams, filters.team),
    optionName(data.filterOptions.stadiums, filters.stadium),
    query.date ? formatCalendarDate(query.date) : undefined,
  ].filter(Boolean).join(" · ");

  // One forced Live request per pull: the probe only refreshes when it is a different query.
  const refreshAll = () => {
    data.refresh();
    if (liveProbeNeeded) liveProbe.refresh();
  };

  const openSheet = () => {
    setSheetKey((key) => key + 1);
    setSheetOpen(true);
  };

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={refreshAll} />}
        contentContainerStyle={local.content}
      >
        <TabHeader title={t("matches.title")} />

        <MatchTabs value={tab} liveAvailable={liveAvailable} onChange={(next) => changeSelection({ filters: { ...filters, date: undefined }, tab: next })} />

        <MatchDateStrip
          tab={tab}
          value={query.date}
          datesWithFixtures={dotDates}
          onSelect={(date) => changeFilters({ ...filters, date })}
        />

        <MatchFilterBar
          filters={query}
          sheetOpen={sheetOpen}
          // Applied filters (incl. a Live date from the sheet, which has no strip) stay visible, even with 0 results.
          summary={state === "results" || state === "filtered-empty" ? summary : undefined}
          onOpen={openSheet}
          onClear={clearFilters}
        />

        {state === "loading" ? (
          <MatchListSkeleton label={t("matches.loading")} count={3} />
        ) : state === "error" ? (
          <StatePanel
            variant="error"
            title={t("matches.error.title")}
            message={data.error ?? undefined}
            action={{ label: t("common.retry"), onPress: data.retry }}
          />
        ) : state === "filtered-empty" ? (
          <StatePanel
            variant="empty"
            title={t("matches.filteredEmpty.title")}
            message={t("matches.filteredEmpty.message")}
            action={{ label: t("filters.clear"), onPress: clearFilters }}
          />
        ) : state === "empty" ? (
          <StatePanel variant="empty" title={t(EMPTY_COPY[tab].title)} message={t(EMPTY_COPY[tab].message)} />
        ) : (
          <>
            {data.error ? (
              // A refresh failed but earlier results are still valid: keep them and offer a retry.
              <StatePanel
                variant="error"
                title={t("matches.error.title")}
                message={data.error}
                action={{ label: t("common.retry"), onPress: data.retry }}
              />
            ) : null}
            <View>
              {groups.map((group, groupIndex) => (
                <MatchGroup
                  key={group.date ?? "undated"}
                  heading={group.date ? formatLongCalendarDate(group.date) : t("matches.dateTbc")}
                >
                  {group.matches.map((match, index) => (
                    <MatchCard key={match.id} match={match} first={index === 0} index={groupIndex * 3 + index} onPress={() => openMatch(match)} />
                  ))}
                </MatchGroup>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <MatchFiltersSheet
        key={sheetKey}
        visible={sheetOpen}
        value={{ filters, tab }}
        options={data.filterOptions}
        onApply={(next) => {
          changeSelection(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

const local = {
  // One readable column on tablets/desktop instead of stretching rows across the screen.
  content: { width: "100%" as const, maxWidth: 760, alignSelf: "center" as const, gap: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
};
