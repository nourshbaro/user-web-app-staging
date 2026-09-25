import { AppText, DirectionalChevron, StatusBadge } from "@/components/foundation";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, spacing } from "@/lib/designTokens";
import type { ApiMatch } from "@/types";
import { Pressable, View, type DimensionValue } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

type Props = {
  match: ApiMatch;
  /** Navigation is supplied by the screen; the card never routes, fetches or owns state. */
  onPress: () => void;
  width?: DimensionValue;
};

/** Standard fixture card: date/kickoff + status, both teams, venue and a tickets affordance. */
export function MatchCard({ match, onPress, width = "100%" }: Props) {
  const theme = useTheme();
  const i18n = useI18n();
  const labels = matchLabels(match, i18n);

  return (
    <Animated.View
      // Subtle, one-shot entrance; skipped when the OS "reduce motion" setting is on.
      entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
      style={{ width, minWidth: 0 }}
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
          local.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: pressed ? theme.colors.actionPrimary : theme.colors.border,
          },
        ]}
      >
        <View style={local.metaRow}>
          <View style={local.when}>
            <AppText variant="label" tone="muted" numberOfLines={1}>{labels.date}</AppText>
            <View style={[local.dot, { backgroundColor: theme.colors.border }]} />
            <AppText variant="label" tone="brand" numberOfLines={1}>{labels.time}</AppText>
          </View>
          <StatusBadge label={labels.statusLabel} tone={labels.statusTone} />
        </View>

        <View style={local.teamsRow}>
          <TeamSide name={labels.home} team={match.home_team} />
          <AppText variant="caption" tone="muted" style={local.vs}>{i18n.t("match.vs")}</AppText>
          <TeamSide name={labels.away} team={match.away_team} />
        </View>

        <View style={[local.footer, { borderTopColor: theme.colors.divider }]}>
          <AppText variant="meta" tone="muted" numberOfLines={1} style={local.venue}>{labels.venue}</AppText>
          <View style={local.cta}>
            <AppText variant="label" tone="brand">{i18n.t("match.tickets")}</AppText>
            <DirectionalChevron kind="forward" size={14} color={theme.colors.tones.brand.fg} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function TeamSide({ name, team }: { name: string; team: ApiMatch["home_team"] }) {
  return (
    <View style={local.teamSide}>
      <TeamCrest team={team} size={44} />
      <AppText variant="cardTitle" align="center" numberOfLines={2} style={local.teamName}>{name}</AppText>
    </View>
  );
}

const local = {
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  metaRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.sm },
  when: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, flexShrink: 1, minWidth: 0 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  teamsRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  teamSide: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: spacing.sm },
  teamName: { fontSize: 15, lineHeight: 20 },
  vs: { marginTop: 14, textTransform: "uppercase" as const },
  footer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  venue: { flex: 1, minWidth: 0 },
  cta: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs, flexShrink: 0 },
};
