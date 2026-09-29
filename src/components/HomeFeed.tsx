import { AppBanner } from "@/components/AppBanner";
import { AppText, DirectionalChevron, SectionHeader, StatePanel, usePressFeedback } from "@/components/foundation";
import { FeaturedMatchCard } from "@/components/match/FeaturedMatchCard";
import { MatchCard } from "@/components/match/MatchCard";
import { MatchGroup } from "@/components/match/MatchGroup";
import { MatchListSkeleton } from "@/components/match/MatchSkeletons";
import { openMatch } from "@/components/MatchesList";
import { BrandHeader } from "@/components/TabHeader";
import { useTheme } from "@/components/ui";
import { useKickoffClock } from "@/hooks/useKickoffClock";
import { useScheduledMatches } from "@/hooks/useScheduledMatches";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, size, spacing } from "@/lib/designTokens";
import { selectHomeMatches } from "@/lib/matchDiscovery";
import { setPrimaryTabTransitionDirection, type PrimaryTabRoute } from "@/lib/navigationPresentation";
import type { MatchFilters } from "@/types";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

const NO_FILTERS: MatchFilters = {};
/** Same number of matches Home showed before (featured + upcoming). */
const HOME_MATCH_LIMIT = 5;

/** Same semantics as the bottom tab: replace, forward transition. */
function switchTab(route: PrimaryTabRoute) {
  setPrimaryTabTransitionDirection(1);
  router.replace(route);
}

/**
 * Home (v3 hierarchy): brand header, the featured (next) match, the backend
 * ads banner, a My Tickets shortcut, then upcoming matches. Match data comes
 * from the same scheduled-matches owner as the Matches screen. Sections the
 * API cannot support (live matches, results, scores) are not shown.
 */
export function HomeFeed() {
  const { t } = useI18n();
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
      <BrandHeader />

      {data.loading ? (
        <MatchListSkeleton label={t("matches.loading")} count={2} withFeatured />
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
        </>
      )}

      <AppBanner />

      <TicketsShortcut />

      {!data.loading && upcoming.length ? (
        <View style={local.section}>
          <SectionHeader
            display
            title={t("home.upcoming.title")}
            action={{ label: t("home.upcoming.viewAll"), onPress: openAllMatches, accessibilityHint: t("home.upcoming.viewAllHint") }}
          />
          <MatchGroup>
            {upcoming.map((match, index) => (
              <MatchCard key={match.id} match={match} variant="dated" first={index === 0} onPress={() => openMatch(match)} />
            ))}
          </MatchGroup>
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * Entry to My Tickets. It deliberately loads nothing: ticket data stays with
 * the Tickets screen and its portal requests, so Home makes no extra call.
 */
function TicketsShortcut() {
  const theme = useTheme();
  const { t } = useI18n();
  const pressFeedback = usePressFeedback();
  return (
    <Pressable
      onPress={() => switchTab("/tickets")}
      accessibilityRole="button"
      accessibilityLabel={t("home.tickets.title")}
      accessibilityHint={t("home.tickets.hint")}
      style={({ pressed }) => [
        local.shortcut,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.hairline, boxShadow: `0 6px 20px ${theme.colors.shadow}` },
        pressFeedback(pressed),
      ]}
    >
      <View style={[local.shortcutIcon, { backgroundColor: theme.colors.tones.brand.bg }]}>
        <SymbolView
          accessible={false}
          name={{ ios: "ticket", android: "confirmation_number", web: "confirmation_number" } as never}
          size={20}
          tintColor={theme.colors.tones.brand.fg}
          fallback={<View />}
        />
      </View>
      <View style={local.shortcutCopy}>
        <AppText variant="bodyStrong" numberOfLines={1}>{t("home.tickets.title")}</AppText>
        <AppText variant="meta" tone="muted" numberOfLines={2}>{t("home.tickets.message")}</AppText>
      </View>
      <DirectionalChevron kind="forward" size={16} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const local = {
  // One readable column on tablets/desktop instead of stretching rows across the screen.
  content: { width: "100%" as const, maxWidth: 760, alignSelf: "center" as const, gap: spacing.xl, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  shortcut: {
    minHeight: size.touchTarget + spacing.xl,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  shortcutIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center" as const, justifyContent: "center" as const },
  shortcutCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
};
