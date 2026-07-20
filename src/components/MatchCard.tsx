import { router } from "expo-router";
import { Image, Pressable, Text, View, type DimensionValue } from "react-native";
import { Card, colors, styles, useTheme } from "@/components/ui";
import { storageUrl } from "@/lib/config";
import { formatDate, formatTime } from "@/lib/format";
import type { ApiMatch } from "@/types";
import Animated, { FadeInDown } from "react-native-reanimated";

export function MatchCard({ match, width = "100%" }: { match: ApiMatch; width?: DimensionValue }) {
  const theme = useTheme();
  const homeShort = match.home_team?.short_name ?? match.home_team?.name?.slice(0, 3).toUpperCase() ?? "H";
  const awayShort = match.away_team?.short_name ?? match.away_team?.name?.slice(0, 3).toUpperCase() ?? "A";

  return (
    <Animated.View entering={FadeInDown.duration(260)} style={[local.matchCardWrap, { width }]}> 
      <Pressable onPress={() => router.push({ pathname: "/match/[id]", params: { id: String(match.id) } })}>
        <Card>
        <View style={[local.competitionBar, { borderBottomColor: theme.colors.line }]}>
          <Text style={styles.sectionLabel}>{formatDate(match.match_date)}</Text>
          <View style={styles.badge}><Text style={styles.badgeText}>{match.status ?? "scheduled"}</Text></View>
        </View>
        <View style={local.teamsRow}>
          <TeamPill name={match.home_team?.name ?? "Home"} shortName={homeShort} logoUrl={storageUrl(match.home_team?.logo)} />
          <View style={local.vsBlock}>
            <View style={[local.vsCircle, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}><Text style={[local.vsText, { color: theme.colors.muted }]}>VS</Text></View>
            <Text style={local.timeText}>{formatTime(match.kickoff_at)}</Text>
          </View>
          <TeamPill name={match.away_team?.name ?? "Away"} shortName={awayShort} logoUrl={storageUrl(match.away_team?.logo)} />
        </View>
        <View style={styles.row}>
          <Text style={styles.muted} numberOfLines={1}>{match.stadium?.name ?? "Stadium TBC"}</Text>
          <View style={local.ticketButton}><Text style={local.ticketText}>Tickets</Text></View>
        </View>
        </Card>
      </Pressable>
    </Animated.View>
  );
}

function TeamPill({ name, shortName, logoUrl }: { name: string; shortName: string; logoUrl?: string }) {
  const theme = useTheme();

  return (
    <View style={local.team}>
      <View style={[local.teamLogo, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
        {logoUrl ? (
          <Image source={{ uri: logoUrl }} style={local.teamLogoImage} resizeMode="contain" />
        ) : (
          <Text style={local.teamLogoText}>{shortName}</Text>
        )}
      </View>
      <Text numberOfLines={2} style={[local.teamName, { color: theme.colors.secondary }]}>{name}</Text>
    </View>
  );
}

const local = {
  matchCardWrap: { minWidth: 0 },
  competitionBar: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF1F6",
  },
  teamsRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingVertical: 14 },
  team: { flex: 1, alignItems: "center" as const, gap: 7 },
  teamLogo: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  },
  teamLogoImage: { width: 46, height: 46 },
  teamLogoText: { color: colors.primary, fontSize: 14, fontWeight: "900" as const },
  teamName: { color: colors.ink, fontSize: 12, fontWeight: "900" as const, textAlign: "center" as const, minHeight: 32 },
  vsBlock: { width: 54, alignItems: "center" as const, gap: 5 },
  vsCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  vsText: { color: colors.muted, fontSize: 11, fontWeight: "900" as const },
  timeText: { color: colors.primary, fontSize: 11, fontWeight: "800" as const },
  ticketButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  ticketText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" as const },
};
