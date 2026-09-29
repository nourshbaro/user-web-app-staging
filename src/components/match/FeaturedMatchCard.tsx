import { AppText, DirectionalChevron, usePressFeedback } from "@/components/foundation";
import { PitchArt } from "@/components/match/PitchArt";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, size, spacing } from "@/lib/designTokens";
import type { ApiMatch } from "@/types";
import { SymbolView } from "expo-symbols";
import { Pressable, View } from "react-native";

type Props = {
  match: ApiMatch;
  onPress: () => void;
};

/**
 * Match-day hero for Home's featured (next) match. The screen chooses which
 * match is featured (`selectHomeMatches`); this component only renders it.
 */
export function FeaturedMatchCard({ match, onPress }: Props) {
  const theme = useTheme();
  const i18n = useI18n();
  const pressFeedback = usePressFeedback();
  const labels = matchLabels(match, i18n);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={i18n.t("match.featured.a11y", {
        home: labels.home,
        away: labels.away,
        date: labels.date,
        time: labels.time,
        venue: labels.venue,
      })}
      accessibilityHint={i18n.t("match.openHint")}
      style={({ pressed }) => [
        local.hero,
        { backgroundColor: theme.colors.hero, boxShadow: `0 18px 40px ${theme.colors.shadow}` },
        pressFeedback(pressed),
      ]}
    >
      <PitchArt />
      {/* Brand rule along the top edge. */}
      <View style={[local.rule, { backgroundColor: theme.colors.actionPrimary }]} />

      {/* The dark surface spans the content width; the match itself stays readable on tablets/desktop. */}
      <View style={local.inner}>
        <View style={local.topRow}>
          <AppText variant="label" tone="onHeroMuted" numberOfLines={1}>{i18n.t("home.featured.label")}</AppText>
          <AppText variant="label" tone="onHero" numberOfLines={1} style={local.date}>{labels.date}</AppText>
        </View>

        <View style={local.teamsRow}>
          <HeroTeam name={labels.home} team={match.home_team} />
          <View style={local.center}>
            <AppText variant="displayKickoff" tone="onHero" align="center" numberOfLines={1}>{labels.time}</AppText>
            <AppText variant="caption" tone="onHeroMuted" align="center">{i18n.t("home.featured.kickoff")}</AppText>
          </View>
          <HeroTeam name={labels.away} team={match.away_team} />
        </View>

        <View style={[local.divider, { backgroundColor: theme.colors.heroHairline }]} />

        <View style={local.footer}>
          <View style={local.venueRow}>
            <SymbolView
              accessible={false}
              name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" } as never}
              size={14}
              tintColor={theme.colors.onHeroMuted}
              fallback={<View />}
            />
            <AppText variant="meta" tone="onHeroMuted" numberOfLines={1} style={local.venueText}>{labels.venue}</AppText>
          </View>
          {/* Visual call to action only: the whole hero is the single press target. */}
          <View style={[local.cta, { backgroundColor: theme.colors.actionPrimary }]}>
            <AppText variant="label" style={{ color: theme.colors.onActionPrimary }}>{i18n.t("match.tickets")}</AppText>
            <DirectionalChevron kind="forward" size={14} color={theme.colors.onActionPrimary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function HeroTeam({ name, team }: { name: string; team: ApiMatch["home_team"] }) {
  return (
    <View style={local.team}>
      <TeamCrest team={team} size={62} />
      <AppText variant="bodyStrong" tone="onHero" align="center" numberOfLines={2}>{name}</AppText>
    </View>
  );
}

const local = {
  hero: { borderRadius: radius.xxl, overflow: "hidden" as const },
  rule: { height: 3, width: "100%" as const },
  inner: {
    width: "100%" as const,
    maxWidth: 720,
    alignSelf: "center" as const,
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  topRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: spacing.md },
  date: { flexShrink: 1 },
  teamsRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  team: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: spacing.sm },
  center: { minWidth: 96, alignItems: "center" as const, paddingTop: spacing.sm },
  divider: { height: 1, width: "100%" as const },
  footer: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  venueRow: { flex: 1, minWidth: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  venueText: { flexShrink: 1 },
  cta: {
    minHeight: size.controlHeightCompact,
    borderRadius: radius.md,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
};
