import { AppText, StatusBadge } from "@/components/foundation";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, spacing } from "@/lib/designTokens";
import type { ApiMatch } from "@/types";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";

/**
 * Dark match hero for Match Details. Renders only backend fields (teams,
 * crests, calendar date, kickoff, stadium, status) through the shared Phase 2
 * labels, so kickoff and status handling match discovery exactly. It never
 * fetches and holds no state.
 */
export function MatchDetailHero({ match, compact }: { match: ApiMatch; compact: boolean }) {
  const theme = useTheme();
  const i18n = useI18n();
  const labels = matchLabels(match, i18n);
  const location = match.stadium?.location?.trim();
  const venue = location ? `${labels.venue}, ${location}` : labels.venue;
  const crestSize = compact ? 56 : 72;

  return (
    <View
      style={[local.hero, { backgroundColor: theme.colors.hero }]}
      // One reading-order summary; crests and duplicated visual text are hidden.
      accessible
      accessibilityRole="summary"
      accessibilityLabel={i18n.t("matchDetail.hero.a11y", {
        home: labels.home,
        away: labels.away,
        date: labels.date,
        time: labels.time,
        venue,
        status: labels.statusLabel,
      })}
    >
      <View style={local.inner}>
        <View style={local.topRow}>
          <StatusBadge label={labels.statusLabel} tone={labels.statusTone} />
          <AppText variant="label" tone="onHeroMuted" numberOfLines={1} style={local.shrink}>
            {labels.date}
          </AppText>
        </View>

        <View style={local.teamsRow}>
          <HeroTeam name={labels.home} team={match.home_team} crestSize={crestSize} compact={compact} />
          <View style={local.center}>
            <AppText variant="caption" tone="onHeroMuted" align="center">{i18n.t("matchDetail.kickoff")}</AppText>
            <AppText variant="numericLarge" tone="onHero" align="center" numberOfLines={1}>{labels.time}</AppText>
            <AppText variant="caption" tone="onHeroMuted" align="center" style={local.vs}>{i18n.t("match.vs")}</AppText>
          </View>
          <HeroTeam name={labels.away} team={match.away_team} crestSize={crestSize} compact={compact} />
        </View>

        <View style={local.venueRow}>
          <SymbolView
            name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" } as never}
            size={16}
            tintColor={theme.colors.onHeroMuted}
            fallback={<View />}
          />
          <AppText variant="meta" tone="onHeroMuted" numberOfLines={2} style={local.shrink}>{venue}</AppText>
        </View>
      </View>
    </View>
  );
}

function HeroTeam({
  name,
  team,
  crestSize,
  compact,
}: {
  name: string;
  team: ApiMatch["home_team"];
  crestSize: number;
  compact: boolean;
}) {
  return (
    <View style={local.team}>
      <TeamCrest team={team} size={crestSize} />
      {/* Long names wrap to three lines rather than truncating the identity of the team. */}
      <AppText variant={compact ? "cardTitle" : "sectionTitle"} tone="onHero" align="center" numberOfLines={3}>
        {name}
      </AppText>
    </View>
  );
}

const local = {
  hero: { borderRadius: radius.lg, padding: spacing.xl, overflow: "hidden" as const },
  inner: { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const, gap: spacing.lg },
  topRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
  },
  shrink: { flexShrink: 1 },
  teamsRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  team: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: spacing.sm },
  center: { minWidth: 88, alignItems: "center" as const, paddingTop: spacing.sm, gap: spacing.xxs },
  vs: { textTransform: "uppercase" as const },
  venueRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing.xs,
  },
};
