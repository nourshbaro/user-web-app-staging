import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Card, Empty, Loading, Screen, colors, styles, useResponsive } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { groupCartItems } from "@/lib/cartDisplay";
import { formatDate, formatMoney, formatTime, minutesSeconds } from "@/lib/format";
import { matchesService } from "@/services/matches";
import type { ApiMatch, FilterOption, MatchFilters } from "@/types";

export default function Index() {
  const responsive = useResponsive();
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [filters, setFilters] = useState<{ teams: FilterOption[]; stadiums: FilterOption[] }>({ teams: [], stadiums: [] });
  const [selected, setSelected] = useState<MatchFilters>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cart = useCart();
  const auth = useAuth();
  const toast = useToast();
  const groupedCartItems = groupCartItems(cart.items);

  const load = async (forceRefresh = false) => {
    setError(null);
    if (!forceRefresh) setLoading(true);
    try {
      const [nextMatches, nextFilters] = await Promise.all([matchesService.list(selected), matchesService.filters()]);
      setMatches(nextMatches);
      setFilters(nextFilters);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load matches.";
      setError(message);
      toast.showToast({ variant: "error", title: "Could not load matches", message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [selected.team, selected.stadium]);

  useFocusEffect(useCallback(() => {
    void cart.refreshCart();
  }, [cart.sessionId]));

  if (loading) return <Loading />;

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
      <View style={local.header}>
        <View style={local.brandRow}>
          <View style={local.logoBox}>
            <Image source={require("../../assets/images/lfa-logo.png")} style={local.logo} resizeMode="contain" />
          </View>
          <View style={local.brandText}>
            <Text style={local.brandName}>Lebanon FA</Text>
            <Text style={styles.muted}>Official fixture feed</Text>
          </View>
        </View>
        <Link href={auth.isAuthenticated ? "/profile" : "/auth"} asChild>
          <Pressable style={local.accountButton}>
            <Text style={local.accountText}>{auth.isAuthenticated ? "Profile" : "Login"}</Text>
          </Pressable>
        </Link>
      </View>

      <View style={local.hero}>
        <View>
          <Text style={styles.sectionLabel}>Scheduled Matches</Text>
          <Text style={local.heroTitle}>Browse upcoming fixtures</Text>
          <Text style={styles.muted}>Secure official LFA tickets in a few taps.</Text>
        </View>
      </View>

      {groupedCartItems.length ? (
        <Pressable onPress={() => router.push("/cart")}>
          <Card>
            <View style={styles.row}>
              <Text style={styles.h2}>{groupedCartItems.length} ticket item{groupedCartItems.length > 1 ? "s" : ""}</Text>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>{minutesSeconds(cart.secondsLeft)}</Text>
            </View>
            <Text style={styles.muted}>{formatMoney(cart.total, cart.currency)} reserved in cart</Text>
          </Card>
        </Pressable>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />}
        contentContainerStyle={{ gap: 12, paddingBottom: 28 }}
      >
        {error ? <Empty title="Could not load matches" detail={error} /> : null}

        <View style={local.filterPanel}>
          <View style={local.filterHeader}>
            <View>
              <Text style={local.listHeaderText}>Fixtures</Text>
              <Text style={local.resultCount}>{matches.length} match{matches.length === 1 ? "" : "es"}</Text>
            </View>
            {(selected.team || selected.stadium) ? (
              <Pressable onPress={() => setSelected({})} style={local.clearButton}>
                <Text style={local.clearText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>

          <ChipRow label="Team">
            <FilterChip title="All" active={!selected.team} onPress={() => setSelected((v) => ({ ...v, team: undefined }))} />
            {filters.teams.map((team) => (
              <FilterChip key={team.slug} title={team.name} active={selected.team === team.slug} onPress={() => setSelected((v) => ({ ...v, team: team.slug }))} />
            ))}
          </ChipRow>

          <ChipRow label="Venue">
            <FilterChip title="All" active={!selected.stadium} onPress={() => setSelected((v) => ({ ...v, stadium: undefined }))} />
            {filters.stadiums.map((stadium) => (
              <FilterChip key={stadium.slug} title={stadium.name} active={selected.stadium === stadium.slug} onPress={() => setSelected((v) => ({ ...v, stadium: stadium.slug }))} />
            ))}
          </ChipRow>
        </View>

        {matches.length ? matches.map((match) => <MatchCard key={match.id} match={match} />) : !error ? <Empty title="No scheduled matches" detail="Try clearing filters or pulling to refresh." /> : null}
      </ScrollView>
      </View>
    </Screen>
  );
}

function FilterChip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[local.filterChip, active && local.filterChipActive]}>
      <Text numberOfLines={1} style={[local.filterChipText, active && local.filterChipTextActive]}>{title}</Text>
    </Pressable>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={local.filterRow}>
      <Text style={local.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={local.filterChips}>
        {children}
      </ScrollView>
    </View>
  );
}

function MatchCard({ match }: { match: ApiMatch }) {
  const homeShort = match.home_team?.short_name ?? match.home_team?.name?.slice(0, 3).toUpperCase() ?? "H";
  const awayShort = match.away_team?.short_name ?? match.away_team?.name?.slice(0, 3).toUpperCase() ?? "A";

  return (
    <Pressable onPress={() => router.push({ pathname: "/match/[id]", params: { id: String(match.id) } })}>
      <Card>
        <View style={local.competitionBar}>
          <Text style={styles.sectionLabel}>Lebanese Premier League</Text>
          <View style={styles.badge}><Text style={styles.badgeText}>{match.status ?? "scheduled"}</Text></View>
        </View>
        <View style={local.teamsRow}>
          <TeamPill name={match.home_team?.name ?? "Home"} shortName={homeShort} />
          <View style={local.vsBlock}>
            <View style={local.vsCircle}><Text style={local.vsText}>VS</Text></View>
            <Text style={local.timeText}>{formatTime(match.kickoff_at)}</Text>
          </View>
          <TeamPill name={match.away_team?.name ?? "Away"} shortName={awayShort} />
        </View>
        <View style={styles.row}>
          <View>
            <Text style={styles.muted}>{formatDate(match.match_date)}</Text>
            <Text style={styles.muted}>{match.stadium?.name ?? "Stadium TBC"}</Text>
          </View>
          <View style={local.ticketButton}><Text style={local.ticketText}>Tickets</Text></View>
        </View>
      </Card>
    </Pressable>
  );
}

function TeamPill({ name, shortName }: { name: string; shortName: string }) {
  return (
    <View style={local.team}>
      <View style={local.teamLogo}><Text style={local.teamLogoText}>{shortName}</Text></View>
      <Text numberOfLines={2} style={local.teamName}>{name}</Text>
    </View>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingTop: 4,
  },
  brandRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  brandText: { flexShrink: 1 },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 18,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  },
  logo: { width: 38, height: 38 },
  brandName: { color: colors.ink, fontSize: 18, fontWeight: "900" as const },
  accountButton: {
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 14,
  },
  accountText: { color: colors.ink, fontSize: 13, fontWeight: "800" as const },
  hero: {
    gap: 6,
    paddingVertical: 8,
  },
  heroTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" as const, lineHeight: 30 },
  filterPanel: {
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: 10,
    gap: 8,
  },
  filterHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  listHeaderText: { color: colors.ink, fontSize: 14, fontWeight: "900" as const },
  resultCount: { color: colors.muted, fontSize: 12, fontWeight: "800" as const, textTransform: "uppercase" as const },
  clearButton: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(200,16,46,0.08)" },
  clearText: { color: colors.primary, fontSize: 12, fontWeight: "900" as const },
  filterRow: { gap: 5 },
  filterLabel: { color: colors.muted, fontSize: 11, fontWeight: "900" as const, textTransform: "uppercase" as const },
  filterChips: { gap: 8, paddingRight: 4 },
  filterChip: {
    maxWidth: 230,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.panel,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: "rgba(200,16,46,0.08)" },
  filterChipText: { color: colors.ink, fontSize: 12, fontWeight: "700" as const },
  filterChipTextActive: { color: colors.primary, fontWeight: "900" as const },
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
    borderRadius: 29,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  teamLogoText: { color: colors.primary, fontSize: 14, fontWeight: "900" as const },
  teamName: { color: colors.ink, fontSize: 12, fontWeight: "900" as const, textAlign: "center" as const, minHeight: 32 },
  vsBlock: { width: 54, alignItems: "center" as const, gap: 5 },
  vsCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  vsText: { color: colors.muted, fontSize: 11, fontWeight: "900" as const },
  timeText: { color: colors.primary, fontSize: 11, fontWeight: "800" as const },
  ticketButton: { backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  ticketText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" as const },
};
