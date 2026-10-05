import { TabHeader } from "@/components/TabHeader";
import { AppText, SkeletonBlock, SkeletonGroup, StatePanel } from "@/components/foundation";
import { MatchCard } from "@/components/match/MatchCard";
import { MatchGroup } from "@/components/match/MatchGroup";
import { MatchListSkeleton } from "@/components/match/MatchSkeletons";
import { TeamCrest } from "@/components/match/TeamCrest";
import { Screen, useResponsive, useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import {
  competitionMatchRoute,
  formatGoalDifference,
  standingsPlanFor,
  standingsView,
  type CompetitionMatch,
  type StandingsResult,
  type CompetitionSummary,
  type StandingRow,
} from "@/lib/competitions";
import { storageUrl } from "@/lib/config";
import { radius, spacing } from "@/lib/designTokens";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { competitionReads } from "@/services/cachedReads";
import { onLiveTransition } from "@/services/matches";
import type { ApiMatch } from "@/types";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";

type Load<T> = { loading: boolean; error: boolean; data: T };

/**
 * Competitions (LFA Screen v3): competition cards, the standings table and
 * the competition's matches, all from the confirmed public endpoints
 * (`competitionReads`). Matches open the one Match Details route, whose
 * backend status decides purchase vs live/result; nothing here decides it.
 */
export default function CompetitionsScreen() {
  const responsive = useResponsive();
  const theme = useTheme();
  const i18n = useI18n();
  const currentTone = theme.colors.tones.success;
  // A recent list renders at once on return to this tab (the service decides whether to re-read).
  const [list, setList] = useState<Load<CompetitionSummary[]>>(() => {
    const cached = competitionReads.peekList();
    return cached ? { loading: false, error: false, data: cached.value } : { loading: true, error: false, data: [] };
  });
  const [selectedId, setSelectedId] = useState<number | null>(() => competitionReads.peekList()?.value[0]?.id ?? null);
  const [standings, setStandings] = useState<Load<StandingsResult | null>>({ loading: true, error: false, data: null });
  const [matches, setMatches] = useState<Load<CompetitionMatch[]>>({ loading: true, error: false, data: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [listRequest] = useState(createRequestAuthority);
  const [detailRequest] = useState(createRequestAuthority);

  useEffect(() => {
    listRequest.mount();
    detailRequest.mount();
    return () => {
      listRequest.unmount();
      detailRequest.unmount();
    };
  }, [detailRequest, listRequest]);

  const loadList = useCallback((force = false) => {
    const ticket = listRequest.begin("list");
    return competitionReads
      .list(force)
      .then((data) => {
        if (!listRequest.isCurrent(ticket)) return;
        setList({ loading: false, error: false, data });
        setSelectedId((current) => (current !== null && data.some((item) => item.id === current) ? current : (data[0]?.id ?? null)));
      })
      .catch(() => {
        if (listRequest.isCurrent(ticket)) setList({ loading: false, error: true, data: [] });
      });
  }, [listRequest]);

  /**
   * `load`: cached sections at once, else skeletons; `retry`: an explicit
   * Retry — skeletons and a forced read (a cached answer such as "Standings
   * unavailable" is never replayed); `refresh`: pull-to-refresh, forced,
   * keeps what is shown; `revalidate`: background (after a match entered or
   * left play), keeps what is shown, and a failure leaves it in place.
   */
  const loadDetail = useCallback(
    (id: number, knockout: boolean, mode: "load" | "retry" | "refresh" | "revalidate" = "load") => {
      const ticket = detailRequest.begin(String(id));
      const force = mode === "retry" || mode === "refresh";
      const quiet = mode === "revalidate";
      // A cup (backend format) has no league table: its standings are never requested.
      if (mode === "load") {
        // Cached sections show at once (no skeleton) while the service serves or re-reads them.
        const cachedStandings = knockout ? null : competitionReads.peekStandings(id);
        const cachedMatches = competitionReads.peekMatches(id);
        setStandings(cachedStandings ? { loading: false, error: false, data: cachedStandings.value } : { loading: !knockout, error: false, data: null });
        setMatches(cachedMatches ? { loading: false, error: false, data: cachedMatches.value } : { loading: true, error: false, data: [] });
      } else if (mode === "retry") {
        setStandings({ loading: !knockout, error: false, data: null });
        setMatches({ loading: true, error: false, data: [] });
      }
      const standingsTask = knockout
        ? Promise.resolve()
        : competitionReads
            .standings(id, force)
            .then((data) => {
              if (detailRequest.isCurrent(ticket)) setStandings({ loading: false, error: false, data });
            })
            .catch(() => {
              if (detailRequest.isCurrent(ticket) && !quiet) setStandings({ loading: false, error: true, data: null });
            });
      const matchesTask = competitionReads
        .matches(id, force)
        .then((data) => {
          if (detailRequest.isCurrent(ticket)) setMatches({ loading: false, error: false, data });
        })
        .catch(() => {
          if (detailRequest.isCurrent(ticket) && !quiet) setMatches({ loading: false, error: true, data: [] });
        });
      return Promise.all([standingsTask, matchesTask]);
    },
    [detailRequest],
  );

  useEffect(() => {
    void loadList();
    return () => listRequest.invalidate();
  }, [listRequest, loadList]);

  const selected = list.data.find((item) => item.id === selectedId) ?? null;
  const knockout = standingsPlanFor(selected?.format) === "knockout";

  useEffect(() => {
    if (selectedId === null) return;
    let active = true;
    // Deferred a tick so the loading state is not set synchronously inside the effect.
    void Promise.resolve().then(() => {
      if (active) return loadDetail(selectedId, knockout);
    });
    return () => {
      active = false;
      detailRequest.invalidate();
    };
  }, [detailRequest, knockout, loadDetail, selectedId]);

  // A match entered or left play: competition matches / standings were dropped; re-read them quietly.
  useEffect(() => {
    if (selectedId === null) return;
    return onLiveTransition(() => void loadDetail(selectedId, knockout, "revalidate"));
  }, [knockout, loadDetail, selectedId]);

  const refresh = () => {
    setRefreshing(true);
    void Promise.all([loadList(true), selectedId !== null ? loadDetail(selectedId, knockout, "refresh") : null]).finally(() => setRefreshing(false));
  };

  // An explicit Retry always reaches the backend.
  const retryDetail = () => {
    if (selectedId !== null) void loadDetail(selectedId, knockout, "retry");
  };

  const table = standings.data?.kind === "table" ? standings.data.standings : null;
  const view = standingsView({ loading: standings.loading, error: standings.error, standings: standings.data });

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <TabHeader title={i18n.t("competitions.title")} />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={local.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        >
          {list.loading ? (
            <SkeletonGroup label={i18n.t("competitions.loading")}>
              <View style={local.cardsRow}>
                {[0, 1, 2].map((key) => <SkeletonBlock key={key} width={124} height={96} borderRadius={16} />)}
              </View>
              <SkeletonBlock width="45%" height={22} />
              <StandingsSkeleton narrow={responsive.width < 360} />
            </SkeletonGroup>
          ) : list.error ? (
            <StatePanel
              variant="error"
              title={i18n.t("competitions.error.title")}
              message={i18n.t("competitions.error.message")}
              action={{ label: i18n.t("common.retry"), onPress: () => { setList({ loading: true, error: false, data: [] }); void loadList(true); } }}
            />
          ) : !list.data.length ? (
            <StatePanel variant="empty" title={i18n.t("competitions.empty.title")} message={i18n.t("competitions.empty.message")} />
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={local.cardsRow}
                accessibilityRole="radiogroup"
                accessibilityLabel={i18n.t("competitions.pick.a11y")}
              >
                {list.data.map((competition) => (
                  <CompetitionCard
                    key={competition.id}
                    competition={competition}
                    selected={competition.id === selectedId}
                    onPress={() => setSelectedId(competition.id)}
                  />
                ))}
              </ScrollView>

              {selected ? (
                <View style={local.heading}>
                  <View style={local.headingCopy}>
                    <AppText variant="displayDay" accessibilityRole="header" style={local.uppercase}>{selected.name}</AppText>
                    {table?.season ? (
                      <AppText variant="meta" tone="muted" style={local.regular}>{i18n.t("competitions.season", { season: table.season.label })}</AppText>
                    ) : null}
                  </View>
                  {table?.season?.isCurrent ? (
                    <View style={[local.current, { backgroundColor: currentTone.bg }]}>
                      <AppText variant="caption" style={{ color: currentTone.fg, fontWeight: "600" }}>{i18n.t("competitions.current")}</AppText>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {knockout ? (
                // v3 cup: no table; a restrained note and the knockout matches lead.
                <View style={[local.knockout, { backgroundColor: theme.colors.surfaceSecondary }]}>
                  <SymbolView name={{ ios: "trophy", android: "emoji_events", web: "emoji_events" } as never} size={16} tintColor={theme.colors.textMuted} fallback={<View />} />
                  <AppText variant="meta" tone="muted" style={local.knockoutText}>{i18n.t("competitions.knockout.note")}</AppText>
                </View>
              ) : view === "loading" ? (
                <SkeletonGroup label={i18n.t("competitions.standings.loading")}>
                  <StandingsSkeleton narrow={responsive.width < 360} />
                </SkeletonGroup>
              ) : view === "error" ? (
                <StatePanel
                  variant="error"
                  title={i18n.t("competitions.standings.error.title")}
                  message={i18n.t("competitions.error.message")}
                  action={{ label: i18n.t("common.retry"), onPress: retryDetail }}
                />
              ) : view === "unavailable" ? (
                <StatePanel
                  variant="empty"
                  title={i18n.t("competitions.standings.unavailable.title")}
                  message={i18n.t("competitions.standings.unavailable.message")}
                  action={{ label: i18n.t("common.retry"), onPress: retryDetail }}
                />
              ) : view === "none" ? (
                <StatePanel
                  variant="empty"
                  title={i18n.t("competitions.standings.none.title")}
                  message={selected?.format === "cup" ? i18n.t("competitions.standings.none.cup") : i18n.t("competitions.standings.none.message")}
                />
              ) : table ? (
                <StandingsTable rows={table.rows} narrow={responsive.width < 360} />
              ) : null}

              <View style={local.matches}>
                {matches.loading ? (
                  <MatchListSkeleton label={i18n.t("competitions.matches.loading")} count={3} />
                ) : matches.error ? (
                  <StatePanel
                    variant="error"
                    title={i18n.t("competitions.matches.error.title")}
                    message={i18n.t("competitions.error.message")}
                    action={{ label: i18n.t("common.retry"), onPress: retryDetail }}
                  />
                ) : matches.data.length ? (
                  <MatchGroup heading={i18n.t("competitions.matches.title")}>
                    {matches.data.map((match, index) => (
                      <MatchCard
                        key={match.id}
                        match={match as unknown as ApiMatch}
                        first={index === 0}
                        index={index}
                        onPress={() => router.push(competitionMatchRoute(match))}
                      />
                    ))}
                  </MatchGroup>
                ) : (
                  <StatePanel variant="empty" title={i18n.t("competitions.matches.empty.title")} message={i18n.t("competitions.matches.empty.message")} />
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

/** The standings table's outline: header row, then rank · crest · team · numbers rows. */
function StandingsSkeleton({ narrow }: { narrow: boolean }) {
  const theme = useTheme();
  const numbers = narrow ? 3 : 6;
  return (
    <View style={[local.table, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
      <View style={[local.tableRow, local.tableHead, { backgroundColor: theme.colors.surfaceSecondary }]}>
        <SkeletonBlock width="30%" height={10} />
      </View>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={[local.tableRow, { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}>
          <SkeletonBlock width={12} height={12} />
          <View style={[local.teamCell, local.teamInner]}>
            <SkeletonBlock width={24} height={24} borderRadius={12} />
            <SkeletonBlock width="55%" height={13} />
          </View>
          {Array.from({ length: numbers }, (_, cell) => (
            <SkeletonBlock key={cell} width={cell >= numbers - 2 ? 22 : 14} height={12} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** v3 competition card: the selected one is the night card. */
function CompetitionCard({ competition, selected, onPress }: { competition: CompetitionSummary; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const i18n = useI18n();
  const logo = storageUrl(competition.logo ?? undefined);
  const short = competition.shortName ?? competition.name;
  const format = competition.format === "league"
    ? i18n.t("competitions.format.league")
    : competition.format === "cup"
      ? i18n.t("competitions.format.cup")
      : competition.format;
  const fg = selected ? theme.colors.onHero : theme.colors.textStrong;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={[competition.name, format].filter(Boolean).join(", ")}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      style={({ pressed }) => [
        local.compCard,
        // One card shadow in both states (the night card is the selection cue);
        // both define boxShadow, so the processed key is never dropped.
        { backgroundColor: selected ? theme.colors.hero : theme.colors.surface, boxShadow: theme.colors.shadowCard },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[local.compMark, { backgroundColor: logo ? theme.colors.scanSurface : selected ? "rgba(255,255,255,0.12)" : theme.colors.crest }]}>
        {logo ? (
          <Image source={{ uri: logo }} style={local.compLogo} resizeMode="contain" accessible={false} />
        ) : (
          <AppText variant="caption" style={{ color: fg, fontWeight: "700" }}>{short.slice(0, 3).toUpperCase()}</AppText>
        )}
      </View>
      <View>
        <AppText variant="bodyStrong" numberOfLines={1} style={{ color: fg }}>{short}</AppText>
        {format ? <AppText variant="caption" numberOfLines={1} style={{ color: fg, opacity: 0.7 }}>{format}</AppText> : null}
      </View>
    </Pressable>
  );
}

/** v3 standings table: # · Team · P W D L · GD · Pts (W/D/L fold away on very narrow phones). */
function StandingsTable({ rows, narrow }: { rows: StandingRow[]; narrow: boolean }) {
  const theme = useTheme();
  const i18n = useI18n();
  const columns = narrow
    ? ([["P", "played"], ["GD", "goalDifference"], ["Pts", "points"]] as const)
    : ([["P", "played"], ["W", "won"], ["D", "drawn"], ["L", "lost"], ["GD", "goalDifference"], ["Pts", "points"]] as const);
  return (
    <View
      style={[local.table, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}
      accessibilityLabel={i18n.t("competitions.standings.a11y")}
    >
      <View style={[local.tableRow, local.tableHead, { backgroundColor: theme.colors.surfaceSecondary }]} accessible={false} importantForAccessibility="no-hide-descendants">
        <AppText variant="caption" tone="muted" style={local.rankCell}>#</AppText>
        <AppText variant="caption" tone="muted" style={local.teamCell}>{i18n.t("competitions.table.team")}</AppText>
        {columns.map(([label]) => (
          <AppText key={label} variant="caption" tone={label === "Pts" ? "strong" : "muted"} align="center" style={label === "GD" || label === "Pts" ? local.wideCell : local.numCell}>
            {label}
          </AppText>
        ))}
      </View>
      {rows.map((row) => (
        <View
          key={`${row.rank}-${row.team.id}`}
          style={[local.tableRow, { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}
          accessible
          accessibilityLabel={i18n.t("competitions.table.rowA11y", {
            rank: row.rank,
            team: row.team.name,
            played: row.played,
            won: row.won,
            drawn: row.drawn,
            lost: row.lost,
            gd: formatGoalDifference(row.goalDifference),
            points: row.points,
          })}
        >
          <AppText variant="meta" tone="muted" style={[local.rankCell, local.semibold]}>{String(row.rank)}</AppText>
          <View style={[local.teamCell, local.teamInner]}>
            <TeamCrest team={row.team} size={24} />
            <AppText variant="meta" numberOfLines={1} style={local.teamName}>{row.team.name}</AppText>
          </View>
          {columns.map(([label, key]) => (
            <AppText
              key={label}
              variant="meta"
              tone={label === "GD" ? "muted" : "strong"}
              align="center"
              style={[label === "GD" || label === "Pts" ? local.wideCell : local.numCell, local.tabular, label === "Pts" ? local.bold : null]}
            >
              {key === "goalDifference" ? formatGoalDifference(row.goalDifference) : String(row[key])}
            </AppText>
          ))}
        </View>
      ))}
    </View>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  content: { gap: spacing.lg, paddingBottom: spacing.xxxl, paddingTop: spacing.sm },
  // The horizontal ScrollView clips its content: the vertical padding is the
  // card shadow's room (`shadowCard`: 6pt offset, 20pt blur), offset by margins.
  cardsRow: { flexDirection: "row" as const, gap: 10, paddingVertical: 14, paddingHorizontal: spacing.xs, marginVertical: -10, marginHorizontal: -spacing.xs },
  knockout: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  knockoutText: { flex: 1 },
  // v3: 124pt card, padding 12, radius 16.
  compCard: { width: 124, gap: 10, padding: 12, borderRadius: 16, minHeight: 96 },
  compMark: { width: 34, height: 34, borderRadius: 17, alignItems: "center" as const, justifyContent: "center" as const, overflow: "hidden" as const },
  compLogo: { width: 28, height: 28 },
  heading: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.md, paddingHorizontal: spacing.xs },
  headingCopy: { flex: 1, minWidth: 0 },
  uppercase: { textTransform: "uppercase" as const },
  regular: { fontWeight: "400" as const },
  current: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  table: { borderRadius: radius.xl, overflow: "hidden" as const },
  tableHead: { paddingVertical: 11 },
  tableRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44 },
  rankCell: { width: 20 },
  teamCell: { flex: 1, minWidth: 0 },
  teamInner: { flexDirection: "row" as const, alignItems: "center" as const, gap: 9 },
  teamName: { flex: 1, minWidth: 0, fontWeight: "500" as const },
  numCell: { width: 22 },
  wideCell: { width: 30 },
  tabular: { fontVariant: ["tabular-nums" as const] },
  semibold: { fontWeight: "600" as const },
  bold: { fontWeight: "700" as const },
  matches: { gap: spacing.sm },
};
