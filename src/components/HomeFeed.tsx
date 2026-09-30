import { AppBanner } from "@/components/AppBanner";
import { AppText, DirectionalChevron, SectionHeader, StatePanel, usePressFeedback } from "@/components/foundation";
import { FeaturedMatchCard } from "@/components/match/FeaturedMatchCard";
import { MatchCard } from "@/components/match/MatchCard";
import { MatchGroup } from "@/components/match/MatchGroup";
import { MatchListSkeleton } from "@/components/match/MatchSkeletons";
import { ScoreCard } from "@/components/match/ScoreCard";
import { openMatch } from "@/components/MatchesList";
import { BrandHeader } from "@/components/TabHeader";
import { useTheme } from "@/components/ui";
import { useKickoffClock } from "@/hooks/useKickoffClock";
import { useLiveRevalidation } from "@/hooks/useLiveRevalidation";
import { useNextTicketMatch, type NextTicketMatch } from "@/hooks/useNextTicketMatch";
import { useScheduledMatches } from "@/hooks/useScheduledMatches";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, spacing } from "@/lib/designTokens";
import { formatDate, formatTime } from "@/lib/format";
import { latestCompletedMatch, selectHomeMatches, sortMatchesByKickoff } from "@/lib/matchDiscovery";
import { setPrimaryTabTransitionDirection, type PrimaryTabRoute } from "@/lib/navigationPresentation";
import type { MatchFilters } from "@/types";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

const NO_FILTERS: MatchFilters = {};
const LIVE_FILTERS: MatchFilters = { status: "live" };
const COMPLETED_FILTERS: MatchFilters = { status: "completed" };
/** Same number of matches Home showed before (featured + upcoming). */
const HOME_MATCH_LIMIT = 5;

/** Same semantics as the bottom tab: replace, forward transition. */
function switchTab(route: PrimaryTabRoute) {
  setPrimaryTabTransitionDirection(1);
  router.replace(route);
}

/**
 * Home (LFA Screen v3): brand header, the featured (next) match, the backend
 * ads banner, the My Tickets card, Live now, Latest result, then upcoming
 * matches. Every section is backend data through the existing owners:
 * `useScheduledMatches` (scheduled / `status=live` / `status=completed`) and
 * the portal (`useNextTicketMatch`). Live now and Latest result appear only
 * when the backend returns such matches; nothing is fabricated (no minutes,
 * events or statistics, which the API does not provide).
 */
export function HomeFeed() {
  const { t } = useI18n();
  const data = useScheduledMatches(NO_FILTERS);
  const live = useScheduledMatches(LIVE_FILTERS);
  const completed = useScheduledMatches(COMPLETED_FILTERS);
  const tickets = useNextTicketMatch();
  // A match that goes live appears on focus / return to foreground, without pull-to-refresh (no interval on Home).
  useLiveRevalidation(live.revalidate);
  // Presentation time: load time, advanced at the next kickoff and on app foreground (no refetch).
  const now = useKickoffClock(data.matches, data.loadedAt);
  const { featured, upcoming } = useMemo(
    () => selectHomeMatches(data.matches, now, HOME_MATCH_LIMIT),
    [data.matches, now],
  );
  const liveMatch = useMemo(() => sortMatchesByKickoff(live.matches)[0] ?? null, [live.matches]);
  // Most recent completed fixture (latest valid kickoff).
  const latestResult = useMemo(() => latestCompletedMatch(completed.matches), [completed.matches]);
  const hasMatches = data.matches.length > 0;

  const openAllMatches = () => {
    // Same semantics as the bottom tab: replace, forward transition.
    setPrimaryTabTransitionDirection(1);
    router.replace("/matches");
  };

  const refreshAll = () => {
    data.refresh();
    live.refresh();
    completed.refresh();
    void tickets.reload();
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={refreshAll} />}
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

      <TicketsCard state={tickets.state} />

      {liveMatch ? (
        <View style={local.section}>
          <SectionHeader display title={t("home.live.title")} />
          <ScoreCard match={liveMatch} />
        </View>
      ) : null}

      {latestResult ? (
        <View style={local.section}>
          <SectionHeader display title={t("home.result.title")} />
          <ScoreCard match={latestResult} />
        </View>
      ) : null}

      {!data.loading && upcoming.length ? (
        <View style={local.section}>
          <SectionHeader
            display
            title={t("home.upcoming.title")}
            action={{ label: t("home.upcoming.viewAll"), onPress: openAllMatches, accessibilityHint: t("home.upcoming.viewAllHint") }}
          />
          <MatchGroup>
            {upcoming.map((match, index) => (
              <MatchCard key={match.id} match={match} variant="dated" first={index === 0} index={index} onPress={() => openMatch(match)} />
            ))}
          </MatchGroup>
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * v3 My Tickets card. Signed in with an upcoming ticketed match: "{n} tickets
 * for {home} v {away}" and its kickoff, from the portal. Otherwise (signed
 * out, none, still loading, or the portal failed) the plain entry to My
 * Tickets, which owns the full ticket states. Either way it switches tab.
 */
function TicketsCard({ state }: { state: NextTicketMatch }) {
  const theme = useTheme();
  const { t, plural } = useI18n();
  const pressFeedback = usePressFeedback();
  const match = state.status === "ready" ? state.match : null;
  const title = match
    ? plural("home.tickets.next", match.ticket_count, { home: match.home_team.name, away: match.away_team.name })
    : t("home.tickets.title");
  const subtitle = match
    ? t("home.tickets.when", { date: formatDate(match.kickoff_at), time: formatTime(match.kickoff_at) })
    : t("home.tickets.message");

  return (
    <Pressable
      onPress={() => switchTab("/tickets")}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityHint={t("home.tickets.hint")}
      style={({ pressed }) => [
        local.ticketsCard,
        { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard },
        pressFeedback(pressed),
      ]}
    >
      <View style={[local.ticketsIcon, { backgroundColor: theme.colors.selectedSurface }]}>
        <SymbolView
          accessible={false}
          name={{ ios: "ticket", android: "confirmation_number", web: "confirmation_number" } as never}
          size={20}
          tintColor={theme.colors.actionPrimary}
          fallback={<View />}
        />
      </View>
      <View style={local.ticketsCopy}>
        <AppText variant="bodyStrong" numberOfLines={2}>{title}</AppText>
        <AppText variant="meta" tone="muted" numberOfLines={2} style={local.ticketsSubtitle}>{subtitle}</AppText>
      </View>
      <DirectionalChevron kind="forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

const local = {
  // One readable column on tablets/desktop instead of stretching rows across the screen.
  content: { width: "100%" as const, maxWidth: 760, alignSelf: "center" as const, gap: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  // v3 section headings: 26pt above, 10pt below.
  section: { gap: 10, marginTop: 10 },
  // v3: padding 12 14, gap 12, radius 18, `--shadow`.
  ticketsCard: {
    minHeight: 66,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: 18,
  },
  ticketsIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center" as const, justifyContent: "center" as const },
  ticketsCopy: { flex: 1, minWidth: 0 },
  ticketsSubtitle: { marginTop: 2 },
};
