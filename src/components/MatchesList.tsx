import { StatePanel } from "@/components/foundation";
import { MatchCard } from "@/components/match/MatchCard";
import { MatchDateStrip, MatchFilterBar, MatchFiltersSheet } from "@/components/match/MatchFilters";
import { MatchGroup } from "@/components/match/MatchGroup";
import { MatchListSkeleton } from "@/components/match/MatchSkeletons";
import { TabHeader } from "@/components/TabHeader";
import { useScheduledMatches } from "@/hooks/useScheduledMatches";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { formatLongCalendarDate } from "@/lib/format";
import { groupMatchesByDate, matchListState, sortMatchesByKickoff } from "@/lib/matchDiscovery";
import type { ApiMatch, MatchFilters } from "@/types";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

export function openMatch(match: ApiMatch) {
  router.push({ pathname: "/match/[id]", params: { id: String(match.id) } });
}

/**
 * Matches (discovery) screen body. Owns the filter values; loading goes
 * through `useScheduledMatches` (the existing service + request authority).
 * The source is `/matches/scheduled`: scheduled fixtures only, so there are no
 * live or results views here.
 */
export function MatchesList() {
  const { t, plural } = useI18n();
  const [filters, setFilters] = useState<MatchFilters>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const data = useScheduledMatches(filters, { withFilterOptions: true });
  const matches = useMemo(() => sortMatchesByKickoff(data.matches), [data.matches]);
  const groups = useMemo(() => groupMatchesByDate(matches), [matches]);
  const state = matchListState({ loading: data.loading, error: data.error, count: matches.length, filters });
  const { invalidate } = data;
  // Every filter change voids the in-flight request synchronously, before state changes.
  const changeFilters = useCallback((next: MatchFilters) => {
    invalidate(next);
    setFilters(next);
  }, [invalidate]);
  const clearFilters = useCallback(() => changeFilters({}), [changeFilters]);

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} />}
        contentContainerStyle={local.content}
      >
        <TabHeader title={t("matches.title")} subtitle={t("matches.subtitle")} />

        <MatchDateStrip
          value={filters.date}
          onSelect={(date) => changeFilters({ ...filters, date })}
          onMore={() => setSheetOpen(true)}
        />

        <MatchFilterBar
          filters={filters}
          options={data.filterOptions}
          sheetOpen={sheetOpen}
          summary={state === "results" ? plural("matches.count", matches.length) : undefined}
          onOpen={() => setSheetOpen(true)}
          onChange={changeFilters}
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
          <StatePanel variant="empty" title={t("matches.empty.title")} message={t("matches.empty.message")} />
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
            <View style={local.groups}>
              {groups.map((group) => (
                <MatchGroup
                  key={group.date ?? "undated"}
                  heading={group.date ? formatLongCalendarDate(group.date) : t("matches.dateTbc")}
                >
                  {group.matches.map((match, index) => (
                    <MatchCard key={match.id} match={match} first={index === 0} onPress={() => openMatch(match)} />
                  ))}
                </MatchGroup>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <MatchFiltersSheet
        visible={sheetOpen}
        filters={filters}
        options={data.filterOptions}
        onChange={changeFilters}
        onClear={clearFilters}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

const local = {
  // One readable column on tablets/desktop instead of stretching rows across the screen.
  content: { width: "100%" as const, maxWidth: 760, alignSelf: "center" as const, gap: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  groups: { gap: spacing.xl },
};
