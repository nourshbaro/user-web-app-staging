import { AppText, DirectionalChevron, usePressFeedback } from "@/components/foundation";
import { LiveBadge } from "@/components/match/LiveBadge";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { formatDayOfMonth, formatWeekdayShort, parseCalendarDate } from "@/lib/format";
import type { ApiMatch } from "@/types";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

type Props = {
  match: ApiMatch;
  /** Navigation is supplied by the screen; the row never routes, fetches or owns state. */
  onPress: () => void;
  /**
   * `dated`: v3 Home upcoming row (day tile, 22pt crests, no chevron).
   * `listed`: v3 Matches row (26pt crests, venue line, chevron).
   */
  variant?: "dated" | "listed";
  /** First row of its grouped card: no separator above it. */
  first?: boolean;
  /** Position in the list, for v3's staggered entrance. */
  index?: number;
};

/** v3 stagger: each row enters 35ms after the previous one. */
function entranceDelay(index: number) {
  return 60 + Math.min(index, 12) * 35;
}

/**
 * One fixture as a row inside a grouped card (LFA Screen v3): both teams with
 * crests, the kickoff time — or the backend score when the response has one —
 * and the backend status.
 */
export function MatchCard({ match, onPress, variant = "listed", first = false, index = 0 }: Props) {
  const theme = useTheme();
  const i18n = useI18n();
  const pressFeedback = usePressFeedback();
  const labels = matchLabels(match, i18n);
  const day = parseCalendarDate(match.match_date);
  const dated = variant === "dated";
  const crest = dated ? 22 : 26;
  const timeUnknown = !labels.score && labels.time === "TBC";

  return (
    <Animated.View
      // v3 staggered entrance (fade + rise); skipped when the OS "reduce motion" setting is on.
      entering={FadeInDown.delay(entranceDelay(index)).duration(360).reduceMotion(ReduceMotion.System)}
      style={first ? null : { borderTopWidth: 1, borderTopColor: theme.colors.hairline }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={i18n.t(labels.score ? "match.a11yScore" : "match.a11y", {
          home: labels.home,
          away: labels.away,
          date: labels.date,
          time: labels.time,
          venue: labels.venue,
          status: labels.isLive ? labels.liveLabel : labels.statusLabel,
          score: labels.score ?? "",
        })}
        accessibilityHint={i18n.t("match.openHint")}
        style={({ pressed }) => [
          dated ? local.datedRow : local.listedRow,
          pressed && { backgroundColor: theme.colors.surfaceSecondary },
          pressFeedback(pressed),
        ]}
      >
        {dated ? (
          <View style={local.dayTile}>
            <AppText variant="overline" tone="muted" align="center" numberOfLines={1} style={local.weekday}>
              {day ? formatWeekdayShort(day) : "—"}
            </AppText>
            <AppText variant="displayDay" align="center" numberOfLines={1}>
              {day ? formatDayOfMonth(day) : "—"}
            </AppText>
          </View>
        ) : null}

        <View style={[local.teams, { gap: dated ? 6 : 7 }]}>
          <TeamLine name={labels.home} team={match.home_team} size={crest} />
          <TeamLine name={labels.away} team={match.away_team} size={crest} />
          {!dated ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} style={local.venue}>{labels.venue}</AppText>
          ) : null}
        </View>

        <View style={local.when}>
          <AppText
            variant="bodyStrong"
            tone={timeUnknown ? "muted" : "strong"}
            numberOfLines={1}
            style={[local.time, !dated && local.timeListed]}
          >
            {labels.score ?? labels.time}
          </AppText>
          {labels.isScheduled ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>{labels.statusLabel}</AppText>
          ) : labels.isLive ? (
            <LiveBadge label={labels.liveLabel} running={labels.clockRunning} />
          ) : (
            // Any other backend status (e.g. completed → "Full time", or none) shown as-is, neutrally.
            <View style={[local.otherBadge, { backgroundColor: theme.colors.bgAlt }]}>
              <AppText variant="caption" tone="muted" numberOfLines={1} style={local.otherText}>{labels.statusLabel}</AppText>
            </View>
          )}
        </View>

        {!dated ? <DirectionalChevron kind="forward" size={16} color={theme.colors.textMuted} /> : null}
      </Pressable>
    </Animated.View>
  );
}

function TeamLine({ name, team, size }: { name: string; team: ApiMatch["home_team"]; size: number }) {
  return (
    <View style={[local.teamLine, { gap: size === 26 ? 10 : 8 }]}>
      <TeamCrest team={team} size={size} />
      <AppText variant="bodyStrong" numberOfLines={1} style={local.teamName}>{name}</AppText>
    </View>
  );
}

const local = {
  // v3: grid 40px | 1fr | auto, gap 14, padding 13/16.
  datedRow: {
    minHeight: 64,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
  },
  // v3: grid 1fr | auto | 16px, gap 12, padding 14 14 14 16.
  listedRow: {
    minHeight: 64,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 14,
    paddingStart: spacing.lg,
    paddingEnd: 14,
  },
  dayTile: { width: 40, alignItems: "center" as const },
  weekday: { fontSize: 11, lineHeight: 15 },
  teams: { flex: 1, minWidth: 0 },
  teamLine: { flexDirection: "row" as const, alignItems: "center" as const },
  teamName: { flexShrink: 1 },
  // Aligned under the team names (26pt crest + 10pt gap).
  venue: { paddingStart: 36 },
  when: { alignItems: "flex-end" as const, gap: 5, maxWidth: "42%" as const },
  time: { fontVariant: ["tabular-nums" as const] },
  timeListed: { fontSize: 16, lineHeight: 21 },
  otherBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  otherText: { fontSize: 11, lineHeight: 15 },
};
