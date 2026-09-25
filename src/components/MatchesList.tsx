import { AppText, StatePanel } from "@/components/foundation";
import { MatchCard } from "@/components/match/MatchCard";
import { MatchFilterBar, MatchFiltersSheet } from "@/components/match/MatchFilters";
import { MatchListSkeleton } from "@/components/match/MatchSkeletons";
import { useResponsive } from "@/components/ui";
import { useScheduledMatches } from "@/hooks/useScheduledMatches";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { matchListState, sortMatchesByKickoff } from "@/lib/matchDiscovery";
import type { ApiMatch, MatchFilters } from "@/types";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View, type DimensionValue } from "react-native";

const GRID_GAP = spacing.md;

/** Responsive columns for match cards; thresholds unchanged from the previous list. */
export function useMatchGrid() {
  const responsive = useResponsive();
  const columns = responsive.width >= 1120 ? 3 : responsive.width >= 720 ? 2 : 1;
  const cardWidth: DimensionValue = columns === 1 ? "100%" : (responsive.contentWidth - GRID_GAP * (columns - 1)) / columns;
  return { columns, cardWidth };
}

export function openMatch(match: ApiMatch) {
  router.push({ pathname: "/match/[id]", params: { id: String(match.id) } });
}

/**
 * Matches (discovery) screen body. Owns the filter values; loading goes
 * through `useScheduledMatches` (the existing service + request authority).
 */
export function MatchesList() {
  const { t, plural } = useI18n();
  const { columns, cardWidth } = useMatchGrid();
  const [filters, setFilters] = useState<MatchFilters>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const data = useScheduledMatches(filters, { withFilterOptions: true });
  const matches = useMemo(() => sortMatchesByKickoff(data.matches), [data.matches]);
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
        <View style={local.titleRow}>
          <AppText variant="screenTitle" accessibilityRole="header">{t("matches.title")}</AppText>
          {state === "results" ? (
            <AppText variant="label" tone="muted">{plural("matches.count", matches.length)}</AppText>
          ) : null}
        </View>

        <MatchFilterBar
          filters={filters}
          options={data.filterOptions}
          sheetOpen={sheetOpen}
          onOpen={() => setSheetOpen(true)}
          onChange={changeFilters}
          onClear={clearFilters}
        />

        {state === "loading" ? (
          <MatchListSkeleton label={t("matches.loading")} count={3} columns={columns} cardWidth={cardWidth} />
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
            <View style={local.grid}>
              {matches.map((match) => (
                <MatchCard key={match.id} match={match} width={cardWidth} onPress={() => openMatch(match)} />
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
  content: { gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  titleRow: { flexDirection: "row" as const, alignItems: "baseline" as const, justifyContent: "space-between" as const, gap: spacing.md },
  grid: { width: "100%" as const, flexDirection: "row" as const, flexWrap: "wrap" as const, gap: GRID_GAP, alignItems: "stretch" as const },
};
