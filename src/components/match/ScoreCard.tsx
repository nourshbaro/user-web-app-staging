import { AppText, usePressFeedback } from "@/components/foundation";
import { LiveDot } from "@/components/match/LiveBadge";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, spacing } from "@/lib/designTokens";
import type { ApiMatch } from "@/types";
import { Pressable, View } from "react-native";

/**
 * v3 Home score card ("Live now" / "Latest result"): both teams, the backend
 * score, and a status line. Presentation only, from backend fields: the score
 * appears only when the response has both scores (otherwise the kickoff time),
 * and "LIVE · 67'" only with the backend list clock minute. Pressing it opens
 * the one Match Details route, whose own status decides live/result.
 */
export function ScoreCard({ match, onPress }: { match: ApiMatch; onPress: () => void }) {
  const theme = useTheme();
  const i18n = useI18n();
  const pressFeedback = usePressFeedback();
  const labels = matchLabels(match, i18n);
  const status = labels.isLive
    ? labels.liveMinute !== null
      ? i18n.t("matchInfo.live.minute", { minute: labels.liveMinute })
      : labels.statusLabel
    : labels.isCompleted
      ? i18n.t("home.result.fullTime", { date: labels.date })
      : labels.statusLabel;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={i18n.t("home.scoreCard.a11y", {
        home: labels.home,
        away: labels.away,
        score: labels.score ?? labels.time,
        status,
      })}
      accessibilityHint={i18n.t("match.openHint")}
      style={({ pressed }) => [local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }, pressFeedback(pressed)]}
    >
      <Side name={labels.home} team={match.home_team} />
      <View style={local.center}>
        <AppText variant="displayScore" align="center" numberOfLines={1}>{labels.score ?? labels.time}</AppText>
        <View style={local.statusRow}>
          {labels.isLive ? <LiveDot running={labels.clockRunning} /> : null}
          <AppText
            variant="overline"
            numberOfLines={1}
            style={[local.status, { color: labels.isLive ? theme.colors.brandInk : theme.colors.textMuted }]}
          >
            {status}
          </AppText>
        </View>
      </View>
      <Side name={labels.away} team={match.away_team} />
    </Pressable>
  );
}

function Side({ name, team }: { name: string; team: ApiMatch["home_team"] }) {
  return (
    <View style={local.side}>
      <TeamCrest team={team} size={40} />
      <AppText variant="bodyStrong" align="center" numberOfLines={1} style={local.name}>{name}</AppText>
    </View>
  );
}

const local = {
  // v3: grid 1fr | auto | 1fr, padding 16 12, radius 20, `--shadow`.
  card: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.xl,
  },
  side: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: spacing.sm },
  name: { fontSize: 14, lineHeight: 19, maxWidth: "100%" as const },
  center: { alignItems: "center" as const, gap: spacing.xs },
  statusRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5 },
  status: { fontSize: 11, lineHeight: 15 },
};
