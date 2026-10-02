import { AppText, DirectionalChevron, SegmentedControl, StatusBadge } from "@/components/foundation";
import { PitchArt } from "@/components/match/PitchArt";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";
import { EASE_OUT_V3, statBarMotion, statBarOrigin, timelineRowMotion } from "@/lib/matchMotion";
import { shortPlayerName } from "@/lib/playerName";
import { layout, size, spacing } from "@/lib/designTokens";
import {
  matchDetailFacts,
  scorerLines,
  statRows,
  timelineRows,
  type StatRow,
  type TimelineKind,
  type TimelineRow,
} from "@/lib/matchDetailFacts";
import type { MatchDetailExperience } from "@/lib/ticketSelection";
import type { ApiMatchDetail } from "@/types";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, RefreshControl, ScrollView, View } from "react-native";
import Reanimated, { FadeInDown } from "react-native-reanimated";

type Tab = "timeline" | "stats";

/**
 * v3 live / result Match Details (the `result` screen: score hero, Timeline /
 * Stats). Shown for every match that is NOT scheduled. It is information
 * only: it renders no zones, quantity, seat picker or cart action, even when
 * the backend response still carries stadium zones.
 *
 * Every value is the backend's (`matchDetailFacts`): a null score side is
 * shown as unavailable (never 0), the minute appears only when the backend
 * sends one, events and statistics render only as supplied, and there is no
 * client-side clock.
 */
export function MatchInfoView({
  match,
  experience,
  topInset,
  compact,
  contentWidth,
  onBack,
  refreshing,
  onRefresh,
}: {
  match: ApiMatchDetail;
  experience: Exclude<MatchDetailExperience, "purchase">;
  topInset: number;
  compact: boolean;
  contentWidth: number;
  onBack: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const [tab, setTab] = useState<Tab>("timeline");
  const reducedMotion = useReducedMotion();
  const labels = matchLabels(match, i18n);
  const facts = matchDetailFacts(match);
  const rows = timelineRows(match);
  const stats = statRows(match);
  const scorers = scorerLines(rows, shortPlayerName);
  const context = [facts.competitionName, facts.roundLabel, labels.date].filter(Boolean).join(" · ");
  const location = match.stadium?.location?.trim();
  const venue = location ? `${labels.venue}, ${location}` : labels.venue;
  const crestSize = compact ? 56 : 68;
  const scoreText = (value: number | null) => (value === null ? "–" : String(value));
  // A missing side reads as unavailable ("1 – –"), never as 0; a full score is v3 "2–1".
  const scoreLine =
    facts.homeScore !== null && facts.awayScore !== null
      ? `${facts.homeScore}–${facts.awayScore}`
      : `${scoreText(facts.homeScore)} : ${scoreText(facts.awayScore)}`;
  const scoreA11y =
    facts.homeScore === null && facts.awayScore === null
      ? i18n.t("matchInfo.score.none")
      : i18n.t("matchInfo.score.a11y", {
          home: labels.home,
          homeScore: facts.homeScore === null ? i18n.t("matchInfo.score.unavailable") : facts.homeScore,
          away: labels.away,
          awayScore: facts.awayScore === null ? i18n.t("matchInfo.score.unavailable") : facts.awayScore,
        });
  const liveLabel =
    facts.liveMinute !== null
      ? i18n.t("matchInfo.live.minute", { minute: facts.liveMinute })
      : i18n.t("matchInfo.live");

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={local.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.colors.primary} onRefresh={onRefresh} />}
    >
      <StatusBar style="light" />
      <View style={[local.hero, { backgroundColor: theme.colors.hero, paddingTop: topInset + spacing.xs }]}>
        <PitchArt />
        <View style={local.inner}>
          <View style={local.topRow}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={i18n.t("common.back")}
              hitSlop={4}
              style={({ pressed }) => [local.back, pressed && { opacity: 0.7 }]}
            >
              <View style={local.backCircle}>
                <DirectionalChevron kind="back" size={18} color={theme.colors.onHero} />
              </View>
            </Pressable>
            <AppText variant="overline" tone="onHeroMuted" align="center" numberOfLines={2} style={local.context}>
              {context}
            </AppText>
            <View style={local.back} />
          </View>

          <View style={local.teamsRow} accessible accessibilityRole="summary" accessibilityLabel={[context, `${labels.home} v ${labels.away}`, scoreA11y, experience === "live" ? liveLabel : experience === "result" ? i18n.t("matchInfo.fullTime") : labels.statusLabel, venue].filter(Boolean).join(". ")}>
            <HeroTeam name={labels.home} team={match.home_team} crestSize={crestSize} />
            <View style={local.center}>
              <AppText variant="displayScore" tone="onHero" align="center" numberOfLines={1} style={local.score}>
                {scoreLine}
              </AppText>
              {experience === "result" ? (
                <View style={[local.chip, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
                  <AppText variant="caption" tone="onHero" style={local.chipText}>{i18n.t("matchInfo.fullTime")}</AppText>
                </View>
              ) : experience === "live" ? (
                <View style={[local.chip, local.liveChip]}>
                  <LiveDot running={facts.clockRunning === true} />
                  <AppText variant="caption" style={[local.chipText, { color: "#FFFFFF" }]}>{liveLabel}</AppText>
                </View>
              ) : (
                <StatusBadge label={labels.statusLabel} tone={labels.statusTone} />
              )}
            </View>
            <HeroTeam name={labels.away} team={match.away_team} crestSize={crestSize} />
          </View>

          {scorers.home.length || scorers.away.length ? (
            <View style={local.scorers} accessible={false} importantForAccessibility="no-hide-descendants">
              <View style={local.scorersHome}>
                {scorers.home.map((line) => (
                  <AppText key={line} variant="caption" tone="onHeroMuted">{line}</AppText>
                ))}
              </View>
              <View style={local.scorersAway}>
                {scorers.away.map((line) => (
                  <AppText key={line} variant="caption" tone="onHeroMuted">{line}</AppText>
                ))}
              </View>
            </View>
          ) : null}

          <View style={local.venueRow}>
            <SymbolView
              name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" } as never}
              size={14}
              tintColor={theme.colors.onHeroMuted}
              fallback={<View />}
            />
            <AppText variant="meta" tone="onHeroMuted" numberOfLines={2} style={local.shrink}>{venue}</AppText>
          </View>
        </View>
      </View>

      <View style={[local.sheet, { backgroundColor: theme.colors.background }]}>
        <View style={[local.column, { width: contentWidth }]}>
          {/* v3 sliding thumb (shared control; instant under reduced motion). */}
          <SegmentedControl
            options={[
              { key: "timeline", label: i18n.t("matchInfo.tab.timeline") },
              { key: "stats", label: i18n.t("matchInfo.tab.stats") },
            ]}
            value={tab}
            onChange={setTab}
            accessibilityLabel={i18n.t("matchInfo.tabs.a11y")}
          />

          <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
            {tab === "timeline" ? (
              rows.length ? (
                <>
                  {rows.map((row, index) => (
                    <Reanimated.View key={row.key} entering={rowEntrance(index, reducedMotion)}>
                      <TimelineItem row={row} first={index === 0} />
                    </Reanimated.View>
                  ))}
                  {experience === "result" ? (
                    <View style={[local.marker, { borderTopColor: theme.colors.hairline }]}>
                      <View style={[local.markerPill, { backgroundColor: theme.colors.bgAlt }]}>
                        <AppText variant="overline" tone="muted">
                          {facts.score
                            ? i18n.t("matchInfo.fullTimeScore", { home: facts.score.home, away: facts.score.away })
                            : i18n.t("matchInfo.fullTime")}
                        </AppText>
                      </View>
                    </View>
                  ) : null}
                </>
              ) : (
                <AppText variant="body" tone="muted" align="center" style={local.empty}>
                  {experience === "live" ? i18n.t("matchInfo.timeline.emptyLive") : i18n.t("matchInfo.timeline.empty")}
                </AppText>
              )
            ) : stats.length ? (
              <>
                <View style={[local.statsHeader, { backgroundColor: theme.colors.surfaceSecondary }]}>
                  <AppText variant="overline" tone="muted" numberOfLines={1} style={local.shrink}>{labels.home}</AppText>
                  <AppText variant="overline" tone="muted" numberOfLines={1} style={local.shrink}>{labels.away}</AppText>
                </View>
                {stats.map((stat, index) => (
                  // v3: Stats rows do not rise in; only their bars grow (StatItem).
                  <StatItem key={stat.key} stat={stat} index={index} />
                ))}
              </>
            ) : (
              <AppText variant="body" tone="muted" align="center" style={local.empty}>
                {i18n.t("matchInfo.stats.empty")}
              </AppText>
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function HeroTeam({ name, team, crestSize }: { name: string; team: ApiMatchDetail["home_team"]; crestSize: number }) {
  return (
    <View style={local.team}>
      <TeamCrest team={team} size={crestSize} onHero />
      <AppText variant="bodyStrong" tone="onHero" align="center" numberOfLines={3} style={local.teamName}>{name}</AppText>
    </View>
  );
}

/**
 * v3 timeline row entrance (`lfEnter .36s`, 60ms + 35ms per row) when the
 * Timeline is shown. None under reduced motion; presentation only.
 */
function rowEntrance(index: number, reducedMotion: boolean) {
  const motion = timelineRowMotion(index, reducedMotion);
  return motion ? FadeInDown.delay(motion.delay).duration(motion.duration) : undefined;
}

/**
 * One v3 share bar: the real share as its width, grown from the centre line
 * (`lfBar`, `statBarMotion`). Final width at once under reduced motion.
 */
function StatBar({ share, color, side, index }: { share: number; color: string; side: "home" | "away"; index: number }) {
  const reducedMotion = useReducedMotion();
  const { isRTL } = useI18n();
  const [grow] = useState(() => new Animated.Value(statBarMotion(index, reducedMotion) ? 0 : 1));
  useEffect(() => {
    const motion = statBarMotion(index, reducedMotion);
    if (!motion) {
      grow.setValue(1);
      return;
    }
    grow.setValue(0);
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: motion.duration,
      delay: motion.delay,
      easing: Easing.bezier(...EASE_OUT_V3),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, index, reducedMotion]);
  return (
    <Animated.View
      style={[
        local.fill,
        {
          width: `${share}%`,
          backgroundColor: color,
          transformOrigin: statBarOrigin(side, isRTL),
          transform: [{ scaleX: grow }],
        },
      ]}
    />
  );
}

/** v3 blinking live dot; it blinks only while the backend clock is running (and never under reduced motion). */
function LiveDot({ running }: { running: boolean }) {
  const reducedMotion = useReducedMotion();
  const [blink] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!running || reducedMotion) {
      blink.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink, reducedMotion, running]);
  return <Animated.View style={[local.dot, { opacity: blink }]} accessible={false} importantForAccessibility="no-hide-descendants" />;
}

const TIMELINE_KIND_LABEL: Record<TimelineKind, MessageKey> = {
  goal: "matchInfo.event.goal",
  yellow_card: "matchInfo.event.yellowCard",
  red_card: "matchInfo.event.redCard",
  substitution: "matchInfo.event.substitution",
  other: "matchInfo.event.other",
};

function TimelineItem({ row, first }: { row: TimelineRow; first: boolean }) {
  const theme = useTheme();
  const i18n = useI18n();
  const kindLabel = i18n.t(TIMELINE_KIND_LABEL[row.kind]);
  const substitution = row.kind === "substitution";
  // v3: a substitution names the player coming on, with "Off {player}" beneath.
  // v3 "F. LastName" display; the spoken label below keeps the full backend name.
  const title = shortPlayerName(substitution ? row.playerIn : row.player) ?? row.teamName ?? kindLabel;
  const detail =
    substitution && row.playerOut
      ? i18n.t("matchInfo.event.subOff", { player: shortPlayerName(row.playerOut) ?? row.playerOut })
      : row.kind !== "other"
        ? kindLabel
        : row.side === null
          ? (row.teamName ?? "")
          : "";
  const a11y = [
    row.minuteLabel,
    kindLabel,
    ...(substitution
      ? [
          row.playerIn ? i18n.t("matchInfo.event.subOnA11y", { player: row.playerIn }) : null,
          row.playerOut ? i18n.t("matchInfo.event.subOffA11y", { player: row.playerOut }) : null,
        ]
      : [row.player, row.shirtNumber !== null ? i18n.t("matchInfo.event.shirt", { number: row.shirtNumber }) : null]),
    row.teamName,
  ]
    .filter(Boolean)
    .join(", ");
  const icon =
    row.kind === "goal" ? (
      <SymbolView
        name={{ ios: "soccerball", android: "sports_soccer", web: "sports_soccer" } as never}
        size={20}
        tintColor={theme.colors.textStrong}
        fallback={<AppText variant="bodyStrong">⚽</AppText>}
      />
    ) : row.kind === "yellow_card" || row.kind === "red_card" ? (
      <View
        style={[
          local.eventCard,
          { backgroundColor: row.kind === "yellow_card" ? theme.colors.eventYellowCard : theme.colors.eventRedCard },
        ]}
      />
    ) : substitution ? (
      <SymbolView
        name={{ ios: "arrow.left.arrow.right", android: "swap_horiz", web: "swap_horiz" } as never}
        size={18}
        tintColor={theme.colors.success}
        fallback={<AppText variant="bodyStrong" style={{ color: theme.colors.success }}>⇄</AppText>}
      />
    ) : (
      <View style={[local.neutralDot, { backgroundColor: theme.colors.textMuted }]} />
    );
  const body = (
    <View style={[local.eventBody, row.side === "home" ? local.eventHome : null]}>
      <View style={local.eventIcon}>{icon}</View>
      <View style={[local.eventCopy, row.side === "home" ? local.eventCopyHome : null]}>
        <AppText variant="bodyStrong" numberOfLines={1} style={local.eventTitle}>{title}</AppText>
        {detail ? <AppText variant="caption" tone="muted" numberOfLines={1}>{detail}</AppText> : null}
      </View>
    </View>
  );
  return (
    <View
      style={[local.eventRow, !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}
      accessible
      accessibilityLabel={a11y}
    >
      <View style={local.eventSide}>{row.side === "home" || row.side === null ? body : null}</View>
      <AppText variant="displayCountdown" tone="muted" align="center" style={local.eventMinute}>
        {row.minuteLabel ?? ""}
      </AppText>
      <View style={local.eventSide}>{row.side === "away" ? body : null}</View>
    </View>
  );
}

function StatItem({ stat, index }: { stat: StatRow; index: number }) {
  const theme = useTheme();
  const i18n = useI18n();
  const label = i18n.t(`matchInfo.stat.${stat.key}`);
  const value = (side: number | null) => (side === null ? "—" : `${side}${stat.unit}`);
  const heavier = (mine: number | null, other: number | null) => mine !== null && other !== null && mine > other;
  const bars = stat.homeShare !== null && stat.awayShare !== null;
  return (
    <View
      style={[local.statRow, { borderTopColor: theme.colors.hairline }]}
      accessible
      accessibilityLabel={i18n.t("matchInfo.stat.a11y", {
        stat: label,
        home: stat.home === null ? i18n.t("matchInfo.score.unavailable") : value(stat.home),
        away: stat.away === null ? i18n.t("matchInfo.score.unavailable") : value(stat.away),
      })}
    >
      <View style={local.statValues}>
        <View style={local.statValueStart}>
          <AppText variant="body" style={[local.statValue, { fontWeight: heavier(stat.home, stat.away) ? "700" : "400" }]}>{value(stat.home)}</AppText>
        </View>
        <AppText variant="meta" tone="muted" align="center" style={local.statLabel}>{label}</AppText>
        <View style={local.statValueEnd}>
          <AppText variant="body" style={[local.statValue, { fontWeight: heavier(stat.away, stat.home) ? "700" : "400" }]}>{value(stat.away)}</AppText>
        </View>
      </View>
      {bars ? (
        <View style={local.bars} accessible={false} importantForAccessibility="no-hide-descendants">
          <View style={[local.track, local.trackHome, { backgroundColor: theme.colors.bgAlt }]}>
            <StatBar side="home" index={index} share={stat.homeShare ?? 0} color={(stat.home ?? 0) >= (stat.away ?? 0) ? theme.colors.textStrong : theme.colors.textMuted} />
          </View>
          <View style={[local.track, { backgroundColor: theme.colors.bgAlt }]}>
            <StatBar side="away" index={index} share={stat.awayShare ?? 0} color={(stat.away ?? 0) >= (stat.home ?? 0) ? theme.colors.textStrong : theme.colors.textMuted} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const local = {
  scroll: { paddingBottom: spacing.xxl },
  // v3 result hero: padding 4 16 44 (the sheet overlaps the last 24pt).
  hero: { width: "100%" as const, paddingHorizontal: spacing.lg, paddingBottom: 44, overflow: "hidden" as const },
  inner: { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const },
  topRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  back: { width: size.touchTargetMin, height: size.touchTargetMin, justifyContent: "center" as const },
  backCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  context: { flex: 1, minWidth: 0 },
  teamsRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm, marginTop: 18 },
  team: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: 10 },
  teamName: { fontSize: 16, lineHeight: 21 },
  center: { alignItems: "center" as const, gap: spacing.sm, paddingTop: 6, paddingHorizontal: spacing.sm },
  // v3: 60pt display score.
  score: { fontSize: 60, lineHeight: 64 },
  chip: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  liveChip: { backgroundColor: "#E8112D" },
  chipText: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 1.1, textTransform: "uppercase" as const },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF" },
  scorers: { flexDirection: "row" as const, gap: 28, marginTop: spacing.lg },
  scorersHome: { flex: 1, alignItems: "flex-end" as const },
  scorersAway: { flex: 1, alignItems: "flex-start" as const },
  venueRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    marginTop: 14,
  },
  shrink: { flexShrink: 1 },
  // v3 sheet: margin-top -24, radius 26, padding 18 16.
  sheet: {
    marginTop: -24,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 18,
    paddingHorizontal: layout.gutter,
  },
  column: { alignSelf: "center" as const, gap: 14 },
  card: { borderRadius: 20, overflow: "hidden" as const },
  empty: { paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  // v3 timeline row: grid 1fr 56 1fr, padding 11 14.
  eventRow: { flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: 11, paddingHorizontal: 14 },
  eventSide: { flex: 1, minWidth: 0 },
  eventMinute: { width: 56 },
  eventBody: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minWidth: 0 },
  eventHome: { flexDirection: "row-reverse" as const },
  eventIcon: { width: 22, height: 22, alignItems: "center" as const, justifyContent: "center" as const },
  eventCopy: { flexShrink: 1, minWidth: 0 },
  eventCopyHome: { alignItems: "flex-end" as const },
  eventTitle: { fontSize: 14 },
  neutralDot: { width: 8, height: 8, borderRadius: 4 },
  eventCard: { width: 12, height: 16, borderRadius: 2.5 },
  marker: { alignItems: "center" as const, paddingVertical: 11, borderTopWidth: 1 },
  markerPill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statsHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  statRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1 },
  statValues: { flexDirection: "row" as const, alignItems: "baseline" as const },
  statValue: { fontSize: 16, fontVariant: ["tabular-nums" as const] },
  statValueStart: { width: 56, alignItems: "flex-start" as const },
  statValueEnd: { width: 56, alignItems: "flex-end" as const },
  statLabel: { flex: 1, fontWeight: "500" as const },
  bars: { flexDirection: "row" as const, gap: 4, marginTop: spacing.sm },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" as const, flexDirection: "row" as const },
  trackHome: { justifyContent: "flex-end" as const },
  fill: { height: "100%" as const, borderRadius: 3 },
};
