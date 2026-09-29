import { AppText, DirectionalChevron, StatusBadge, usePressFeedback } from "@/components/foundation";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { size, spacing } from "@/lib/designTokens";
import { formatDayOfMonth, formatWeekdayShort, parseCalendarDate } from "@/lib/format";
import type { ApiMatch } from "@/types";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

type Props = {
  match: ApiMatch;
  /** Navigation is supplied by the screen; the row never routes, fetches or owns state. */
  onPress: () => void;
  /**
   * `dated`: a leading day tile (Home's upcoming list).
   * `listed`: the venue under the teams (Matches, where rows sit under a date heading).
   */
  variant?: "dated" | "listed";
  /** First row of its grouped card: no separator above it. */
  first?: boolean;
};

/**
 * One fixture as a row inside a grouped card (v3): both teams with crests,
 * kickoff time and the backend status, plus a forward affordance.
 */
export function MatchCard({ match, onPress, variant = "listed", first = false }: Props) {
  const theme = useTheme();
  const i18n = useI18n();
  const pressFeedback = usePressFeedback();
  const labels = matchLabels(match, i18n);
  const day = parseCalendarDate(match.match_date);

  return (
    <Animated.View
      // Subtle, one-shot entrance; skipped when the OS "reduce motion" setting is on.
      entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
      style={first ? null : { borderTopWidth: 1, borderTopColor: theme.colors.hairline }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={i18n.t("match.a11y", {
          home: labels.home,
          away: labels.away,
          date: labels.date,
          time: labels.time,
          venue: labels.venue,
          status: labels.statusLabel,
        })}
        accessibilityHint={i18n.t("match.openHint")}
        style={({ pressed }) => [
          local.row,
          pressed && { backgroundColor: theme.colors.surfaceSecondary },
          pressFeedback(pressed),
        ]}
      >
        {variant === "dated" ? (
          <View style={local.dayTile}>
            <AppText variant="caption" tone="muted" align="center" numberOfLines={1} style={local.weekday}>
              {day ? formatWeekdayShort(day) : "—"}
            </AppText>
            <AppText variant="displayNumeral" align="center" numberOfLines={1}>
              {day ? formatDayOfMonth(day) : "—"}
            </AppText>
          </View>
        ) : null}

        <View style={local.teams}>
          <TeamLine name={labels.home} team={match.home_team} />
          <TeamLine name={labels.away} team={match.away_team} />
          {variant === "listed" ? (
            <AppText variant="caption" tone="muted" numberOfLines={1} style={local.venue}>{labels.venue}</AppText>
          ) : null}
        </View>

        <View style={local.when}>
          <AppText variant="bodyStrong" numberOfLines={1} style={local.time}>{labels.time}</AppText>
          {labels.isScheduled ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>{labels.statusLabel}</AppText>
          ) : (
            // Any non-scheduled backend status (or none) is shown as-is, neutrally.
            <StatusBadge label={labels.statusLabel} tone={labels.statusTone} />
          )}
        </View>

        <DirectionalChevron kind="forward" size={16} color={theme.colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

function TeamLine({ name, team }: { name: string; team: ApiMatch["home_team"] }) {
  return (
    <View style={local.teamLine}>
      <TeamCrest team={team} size={26} />
      <AppText variant="bodyStrong" numberOfLines={1} style={local.teamName}>{name}</AppText>
    </View>
  );
}

const local = {
  row: {
    minHeight: size.touchTarget + spacing.xxl,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingStart: spacing.lg,
    paddingEnd: spacing.md,
  },
  dayTile: { width: 44, alignItems: "center" as const },
  weekday: { textTransform: "uppercase" as const },
  teams: { flex: 1, minWidth: 0, gap: spacing.sm },
  teamLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  teamName: { flexShrink: 1 },
  // Aligned under the team names (crest 26 + gap).
  venue: { paddingStart: 26 + spacing.sm },
  when: { alignItems: "flex-end" as const, gap: spacing.xs, maxWidth: "40%" as const },
  time: { fontVariant: ["tabular-nums" as const] },
};
