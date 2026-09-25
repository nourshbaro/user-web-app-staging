import { AppBanner } from "@/components/AppBanner";
import { SectionHeader, StatePanel } from "@/components/foundation";
import { FeaturedMatchCard } from "@/components/match/FeaturedMatchCard";
import { MatchCard } from "@/components/match/MatchCard";
import { MatchListSkeleton } from "@/components/match/MatchSkeletons";
import { openMatch, useMatchGrid } from "@/components/MatchesList";
import { useKickoffClock } from "@/hooks/useKickoffClock";
import { useScheduledMatches } from "@/hooks/useScheduledMatches";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { selectHomeMatches } from "@/lib/matchDiscovery";
import { setPrimaryTabTransitionDirection } from "@/lib/navigationPresentation";
import type { MatchFilters } from "@/types";
import { router } from "expo-router";
import { useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

const NO_FILTERS: MatchFilters = {};
/** Same number of matches Home showed before (featured + upcoming). */
const HOME_MATCH_LIMIT = 5;

/**
 * Home: backend ads banner, the featured (next) match, then upcoming matches.
 * Data comes from the same scheduled-matches owner as the Matches screen.
 */
export function HomeFeed() {
  const { t } = useI18n();
  const { columns, cardWidth } = useMatchGrid();
  const data = useScheduledMatches(NO_FILTERS);
  // Presentation time: load time, advanced at the next kickoff and on app foreground (no refetch).
  const now = useKickoffClock(data.matches, data.loadedAt);
  const { featured, upcoming } = useMemo(
    () => selectHomeMatches(data.matches, now, HOME_MATCH_LIMIT),
    [data.matches, now],
  );
  const hasMatches = data.matches.length > 0;

  const openAllMatches = () => {
    // Same semantics as the bottom tab: replace, forward transition.
    setPrimaryTabTransitionDirection(1);
    router.replace("/matches");
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} />}
      contentContainerStyle={local.content}
    >
      <AppBanner />

      {data.loading ? (
        <MatchListSkeleton label={t("matches.loading")} count={2} columns={columns} cardWidth={cardWidth} withFeatured />
      ) : data.error && !hasMatches ? (
        <StatePanel
          variant="error"
          title={t("matches.error.title")}
          message={data.error}
          action={{ label: t("common.retry"), onPress: data.retry }}
        />
      ) : !hasMatches ? (
        <StatePanel variant="empty" title={t("matches.empty.title")} message={t("matches.empty.message")} />
      ) : (
        <>
          {data.error ? (
            <StatePanel
              variant="error"
              title={t("matches.error.title")}
              message={data.error}
              action={{ label: t("common.retry"), onPress: data.retry }}
            />
          ) : null}

          {featured ? (
            <FeaturedMatchCard match={featured} onPress={() => openMatch(featured)} />
          ) : (
            // Matches exist but none has an upcoming, valid kickoff: say so, never feature a past fixture.
            <StatePanel
              variant="empty"
              title={t("home.noUpcoming.title")}
              message={t("home.noUpcoming.message")}
              action={{ label: t("home.upcoming.viewAll"), onPress: openAllMatches }}
            />
          )}

          {upcoming.length ? (
            <View style={local.section}>
              <SectionHeader
                title={t("home.upcoming.title")}
                action={{ label: t("home.upcoming.viewAll"), onPress: openAllMatches, accessibilityHint: t("home.upcoming.viewAllHint") }}
              />
              <View style={local.grid}>
                {upcoming.map((match) => (
                  <MatchCard key={match.id} match={match} width={cardWidth} onPress={() => openMatch(match)} />
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const local = {
  content: { gap: spacing.xl, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  section: { gap: spacing.md },
  grid: { width: "100%" as const, flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.md, alignItems: "stretch" as const },
};
