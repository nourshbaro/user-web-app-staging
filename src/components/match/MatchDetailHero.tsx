import { AppText, NavigationBackGlyph, StatusBadge } from "@/components/foundation";
import { PitchArt } from "@/components/match/PitchArt";
import { TeamCrest } from "@/components/match/TeamCrest";
import { matchLabels } from "@/components/match/matchLabels";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { size, spacing } from "@/lib/designTokens";
import { matchDetailFacts } from "@/lib/matchDetailFacts";
import type { ApiMatch, ApiMatchDetail } from "@/types";
import { SymbolView } from "expo-symbols";
import { Pressable, View } from "react-native";

/**
 * v3 night hero for the scheduled (ticket-purchase) Match Details, over the
 * v3 pitch art. Renders only backend fields: teams, crests, calendar date,
 * kickoff, stadium and status through the shared Phase 2 labels, plus the
 * single-match competition and matchday (`matchDetailFacts`). Live and
 * completed matches use `MatchInfoView` instead. It never fetches and holds
 * no state; Back is the screen's own handler.
 *
 * The bottom padding leaves room for the content sheet that overlaps it.
 */
export function MatchDetailHero({
  match,
  compact,
  topInset,
  onBack,
}: {
  match: ApiMatchDetail;
  compact: boolean;
  /** Status-bar inset the hero paints behind. */
  topInset: number;
  onBack: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const labels = matchLabels(match, i18n);
  const facts = matchDetailFacts(match);
  const context = [facts.competitionName, facts.roundLabel].filter(Boolean).join(" · ");
  const location = match.stadium?.location?.trim();
  const venue = location ? `${labels.venue}, ${location}` : labels.venue;
  const crestSize = compact ? 56 : 68;

  return (
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
              <NavigationBackGlyph size={22} color={theme.colors.onHero} />
            </View>
          </Pressable>
          <View style={local.dateBlock}>
            <AppText variant="meta" tone="onHeroMuted" align="center" numberOfLines={1} style={local.date}>
              {labels.date}
            </AppText>
            {context ? (
              <AppText variant="caption" tone="onHeroMuted" align="center" numberOfLines={1}>
                {context}
              </AppText>
            ) : null}
          </View>
          {/* Keeps the date centred opposite the back button. */}
          <View style={local.back} />
        </View>

        <View
          // One reading-order summary; crests and duplicated visual text are hidden.
          accessible
          accessibilityRole="summary"
          accessibilityLabel={[
            context,
            i18n.t("matchDetail.hero.a11y", {
              home: labels.home,
              away: labels.away,
              date: labels.date,
              time: labels.time,
              venue,
              status: labels.statusLabel,
            }),
          ]
            .filter(Boolean)
            .join(". ")}
          style={local.body}
        >
          <View style={local.teamsRow}>
            <HeroTeam name={labels.home} team={match.home_team} crestSize={crestSize} />
            <View style={local.center}>
              <AppText variant="displayKickoff" tone="onHero" align="center" numberOfLines={1}>{labels.time}</AppText>
              <AppText variant="caption" tone="onHeroMuted" align="center">{i18n.t("matchDetail.kickoff")}</AppText>
            </View>
            <HeroTeam name={labels.away} team={match.away_team} crestSize={crestSize} />
          </View>

          {/* v3 shows no badge for an ordinary scheduled match. */}
          {labels.isScheduled ? null : (
            <View style={local.status}>
              <StatusBadge label={labels.statusLabel} tone={labels.statusTone} />
            </View>
          )}

          <View style={local.venueRow}>
            <SymbolView
              name={{ ios: "mappin.and.ellipse", android: "location_on", web: "location_on" } as never}
              size={15}
              tintColor={theme.colors.onHeroMuted}
              fallback={<View />}
            />
            <AppText variant="meta" tone="onHeroMuted" numberOfLines={2} style={local.shrink}>{venue}</AppText>
          </View>
        </View>
      </View>
    </View>
  );
}

function HeroTeam({ name, team, crestSize }: { name: string; team: ApiMatch["home_team"]; crestSize: number }) {
  return (
    <View style={local.team}>
      <TeamCrest team={team} size={crestSize} onHero />
      {/* Long names wrap to three lines rather than truncating the identity of the team. */}
      <AppText variant="bodyStrong" tone="onHero" align="center" numberOfLines={3} style={local.teamName}>
        {name}
      </AppText>
    </View>
  );
}

const local = {
  // v3: padding 4 16 44 — the content sheet overlaps the last 24pt.
  hero: { width: "100%" as const, paddingHorizontal: spacing.lg, paddingBottom: 44, overflow: "hidden" as const },
  inner: { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const, gap: spacing.lg },
  topRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  back: { width: size.touchTargetMin, height: size.touchTargetMin, justifyContent: "center" as const },
  // v3: 38pt circle, rgba(255,255,255,.12).
  backCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  dateBlock: { flex: 1, minWidth: 0, alignItems: "center" as const },
  date: { fontWeight: "600" as const },
  body: { gap: spacing.lg },
  shrink: { flexShrink: 1 },
  teamsRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  team: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: spacing.sm },
  teamName: { fontSize: 17, lineHeight: 22 },
  center: { minWidth: 96, alignItems: "center" as const, paddingTop: spacing.md, gap: 2 },
  status: { alignItems: "center" as const },
  venueRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing.xs,
    marginTop: 2,
  },
};
