import { FlowHeader } from "@/components/FlowHeader";
import { TabHeader } from "@/components/TabHeader";
import {
  AppText,
  DirectionalChevron,
  PhysicalLayout,
  SegmentedControl,
  SkeletonBlock,
  SkeletonGroup,
  StatePanel,
} from "@/components/foundation";
import { PitchArt } from "@/components/match/PitchArt";
import { TeamCrest } from "@/components/match/TeamCrest";
import { Button, Screen, useResponsive, useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useAuth } from "@/context/AuthContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { layout, radius, size, spacing } from "@/lib/designTokens";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { createRequestAuthority } from "@/lib/requestAuthority";
import {
  rawStatusLabel,
  ticketIsScannable,
  ticketListSections,
  ticketListView,
  ticketQrSource,
  withBackendQrs,
  ticketSeatFacts,
  ticketVisualState,
  TICKET_FILTERS,
  type TicketFilter,
  type TicketVisualState,
} from "@/lib/ticketPresentation";
import { getUserScopedCacheGeneration } from "@/lib/userScopedCache";
import { profileService } from "@/services/auth";
import type { PortalMatch, PortalTicket } from "@/types";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type I18n = ReturnType<typeof useI18n>;

/**
 * My Tickets (LFA Screen v3). The portal owns everything shown: which matches
 * are upcoming or past (`/portal/matches?filter=` and `is_upcoming`), each
 * ticket's status and check-in, and the QR image. Requests are guarded by
 * request authorities and the user-scoped cache generation, so a stale
 * filter, a closed detail or a former session never lands on screen.
 */
function TicketsScreen() {
  const auth = useAuth();
  const i18n = useI18n();
  const responsive = useResponsive();
  const [filter, setFilter] = useState<TicketFilter>("all");
  const [matches, setMatches] = useState<PortalMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<PortalMatch | null>(null);
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [listRequest] = useState(createRequestAuthority);
  const [detailRequest] = useState(createRequestAuthority);

  const load = useCallback(() => {
    if (!auth.isReady || !auth.isAuthenticated) return;
    const request = listRequest.begin(filter);
    const generation = getUserScopedCacheGeneration();
    const current = () =>
      listRequest.isCurrent(request) &&
      generation === getUserScopedCacheGeneration();
    return profileService
      .matches(filter)
      .then((result) => {
        if (current()) {
          setMatches(result.items);
          setError(false);
        }
      })
      .catch(() => {
        if (current()) {
          setMatches([]);
          setError(true);
        }
      })
      .finally(() => {
        if (current()) {
          setLoading(false);
          setRefreshing(false);
        }
      });
  }, [auth.isReady, auth.isAuthenticated, filter, listRequest]);

  useEffect(() => {
    listRequest.mount();
    detailRequest.mount();
    return () => {
      listRequest.unmount();
      detailRequest.unmount();
    };
  }, [listRequest, detailRequest]);

  useEffect(() => {
    void load();
    return () => listRequest.invalidate();
  }, [load, listRequest]);

  const reload = () => {
    setRefreshing(true);
    setError(false);
    void load();
  };

  const retry = () => {
    setLoading(true);
    setError(false);
    void load();
  };

  const changeFilter = (next: TicketFilter) => {
    if (next === filter) return;
    listRequest.invalidate();
    detailRequest.invalidate();
    setSelected(null);
    setMatches([]);
    setLoading(true);
    setError(false);
    setFilter(next);
  };

  const openMatch = async (match: PortalMatch) => {
    const request = detailRequest.begin(String(match.match_id));
    const generation = getUserScopedCacheGeneration();
    const current = () =>
      detailRequest.isCurrent(request) &&
      generation === getUserScopedCacheGeneration();
    setSelected(match);
    setTickets([]);
    setDetailError(false);
    setDetailLoading(true);
    try {
      const result = await profileService.tickets(match.match_id);
      if (!current()) return;
      setTickets(result.items);
      // A listed ticket without a usable backend QR image takes the QR from
      // its own detail endpoint; nothing is ever generated locally.
      const detailed = await withBackendQrs(result.items, (code) => profileService.ticket(code), current);
      if (current()) setTickets(detailed);
    } catch {
      if (current()) setDetailError(true);
    } finally {
      if (current()) setDetailLoading(false);
    }
  };

  const view = ticketListView({ loading, error, count: matches.length });
  const sections = ticketListSections(filter, matches);
  const filterLabel = (key: TicketFilter) => i18n.t(`myTickets.filter.${key}`);

  return (
    <Screen>
      <Stack.Screen options={{ title: i18n.t("myTickets.title") }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <TabHeader title={i18n.t("myTickets.title")} />
        <View style={local.filters}>
          <SegmentedControl
            options={TICKET_FILTERS.map((key) => ({ key, label: filterLabel(key) }))}
            value={filter}
            onChange={changeFilter}
            accessibilityLabel={i18n.t("myTickets.filters.a11y")}
          />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={local.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
        >
          {view === "loading" ? (
            <SkeletonGroup label={i18n.t("myTickets.loading")}>
              {[0, 1, 2].map((key) => (
                <SkeletonBlock key={key} height={104} borderRadius={radius.xl} />
              ))}
            </SkeletonGroup>
          ) : view === "error" ? (
            <StatePanel
              variant="error"
              title={i18n.t("myTickets.error.title")}
              message={i18n.t("myTickets.error.message")}
              action={{ label: i18n.t("common.retry"), onPress: retry }}
            />
          ) : view === "empty" ? (
            <StatePanel
              variant="empty"
              title={i18n.t(`myTickets.empty.${filter}.title`)}
              message={i18n.t(`myTickets.empty.${filter}.message`)}
              action={{ label: i18n.t("myTickets.browse"), onPress: () => router.replace("/matches") }}
            />
          ) : (
            sections.map((section) => (
              <View key={section.key} style={local.section}>
                {filter === "all" ? (
                  <AppText variant="overline" tone="muted" accessibilityRole="header" style={local.sectionHead}>
                    {i18n.t(`myTickets.section.${section.key === "past" ? "past" : "upcoming"}`)}
                  </AppText>
                ) : null}
                {section.items.map((match) => (
                  <PortalMatchCard
                    key={String(match.match_id)}
                    match={match}
                    onPress={() => void openMatch(match)}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </View>
      {selected ? (
        <TicketViewer
          match={selected}
          tickets={tickets}
          loading={detailLoading}
          error={detailError}
          onRetry={() => void openMatch(selected)}
          onClose={() => {
            detailRequest.invalidate();
            setSelected(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

/** v3 ticket stub: match on the left, ticket count on the perforated stub. */
function PortalMatchCard({ match, onPress }: { match: PortalMatch; onPress: () => void }) {
  const theme = useTheme();
  const i18n = useI18n();
  const date = formatDate(match.kickoff_at);
  const time = formatTime(match.kickoff_at);
  const title = `${match.home_team.name} v ${match.away_team.name}`;
  const countLabel = i18n.plural("myTickets.count", match.ticket_count);
  // Past matches are quieter (v3), from the backend's own `is_upcoming`.
  const past = !match.is_upcoming;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={i18n.t("myTickets.card.a11y", {
        match: title,
        date,
        time,
        venue: match.stadium ?? "",
        count: `${match.ticket_count} ${countLabel}`,
      })}
      style={({ pressed }) => [
        local.card,
        { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard },
        past && local.cardPast,
        pressed && local.pressed,
      ]}
    >
      <View style={local.cardMain}>
        <AppText variant="meta" tone={past ? "muted" : "strong"} numberOfLines={1}>{`${date} · ${time}`}</AppText>
        <View style={local.cardTeams}>
          <View style={local.crests}>
            <TeamCrest team={match.home_team} size={28} />
            <View style={local.crestOverlap}>
              <TeamCrest team={match.away_team} size={28} />
            </View>
          </View>
          <AppText variant="bodyStrong" numberOfLines={1} style={local.cardTitle}>{title}</AppText>
        </View>
        {match.stadium ? (
          <AppText variant="caption" tone="muted" numberOfLines={1}>{match.stadium}</AppText>
        ) : null}
      </View>
      <View style={[local.stub, { borderColor: theme.colors.border }]}>
        <AppText variant="displaySection" style={{ color: past ? theme.colors.textMuted : theme.colors.brandInk }}>
          {String(match.ticket_count)}
        </AppText>
        <AppText variant="caption" tone="muted">{countLabel}</AppText>
      </View>
      {/* Perforation notches (decorative). */}
      <View pointerEvents="none" style={[local.notch, local.notchTop, { backgroundColor: theme.colors.background }]} />
      <View pointerEvents="none" style={[local.notch, local.notchBottom, { backgroundColor: theme.colors.background }]} />
    </Pressable>
  );
}

/**
 * v3 ticket screen for one match: a pager of flip tickets. Presented modally
 * over My Tickets so the list's request ownership is unchanged.
 */
function TicketViewer({
  match,
  tickets,
  loading,
  error,
  onRetry,
  onClose,
}: {
  match: PortalMatch;
  tickets: PortalTicket[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const pageWidth = Math.min(width, layout.readableWidth + layout.gutter * 2);
  const total = tickets.length;

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    setIndex(clamped);
    pagerRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
  };

  return (
    <Modal visible animationType={reducedMotion ? "fade" : "slide"} presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[local.viewer, { backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={local.viewerHeader}>
          <View style={local.viewerHeaderBack}>
            <FlowHeader
              title={`${match.home_team.name} v ${match.away_team.name}`}
              subtitle={total > 1 ? i18n.t("myTickets.position", { index: index + 1, total }) : undefined}
              backLabel={i18n.t("myTickets.back")}
              onBack={onClose}
            />
          </View>
        </View>
        {loading ? (
          <View style={local.viewerBody}>
            <SkeletonGroup label={i18n.t("myTickets.detail.loading")}>
              <SkeletonBlock height={520} borderRadius={22} />
            </SkeletonGroup>
          </View>
        ) : error && !total ? (
          <View style={local.viewerBody}>
            <StatePanel
              variant="error"
              title={i18n.t("myTickets.detail.error.title")}
              message={i18n.t("myTickets.detail.error.message")}
              action={{ label: i18n.t("common.retry"), onPress: onRetry }}
            />
          </View>
        ) : !total ? (
          <View style={local.viewerBody}>
            <StatePanel
              variant="empty"
              title={i18n.t("myTickets.detail.empty.title")}
              message={i18n.t("myTickets.detail.empty.message")}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={local.viewerScroll} showsVerticalScrollIndicator={false}>
            {error ? (
              <View style={local.viewerNotice}>
                <StatePanel
                  variant="error"
                  title={i18n.t("myTickets.detail.partial.title")}
                  message={i18n.t("myTickets.detail.error.message")}
                  action={{ label: i18n.t("common.retry"), onPress: onRetry }}
                />
              </View>
            ) : null}
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / pageWidth))}
              style={[local.pager, { width: pageWidth }]}
            >
              {tickets.map((ticket, ticketIndex) => (
                <View key={ticket.ticket_code || String(ticketIndex)} style={{ width: pageWidth, paddingHorizontal: layout.gutter }}>
                  <FlipTicket ticket={ticket} match={match} />
                </View>
              ))}
            </ScrollView>
            {total > 1 ? (
              <View style={local.pagerControls}>
                <PagerButton label={i18n.t("myTickets.prev")} kind="back" disabled={index === 0} onPress={() => goTo(index - 1)} />
                <View style={local.dots} accessible accessibilityLabel={i18n.t("myTickets.position", { index: index + 1, total })}>
                  {tickets.map((ticket, dot) => (
                    <View
                      key={ticket.ticket_code || String(dot)}
                      style={[local.dot, { width: dot === index ? 18 : 6, backgroundColor: dot === index ? theme.colors.textStrong : theme.colors.border }]}
                    />
                  ))}
                </View>
                <PagerButton label={i18n.t("myTickets.next")} kind="forward" disabled={index >= total - 1} onPress={() => goTo(index + 1)} />
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function PagerButton({ label, kind, disabled, onPress }: { label: string; kind: "back" | "forward"; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      hitSlop={4}
      style={[local.pagerButton, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard, opacity: disabled ? 0.35 : 1 }]}
    >
      {/* Previous / next follow the reading direction (the pager mirrors in RTL). */}
      <DirectionalChevron kind={kind} size={16} color={theme.colors.textStrong} />
    </Pressable>
  );
}

function stateLabel(i18n: I18n, state: TicketVisualState, status: string) {
  return state === "other" ? rawStatusLabel(status) : i18n.t(`myTickets.state.${state}`);
}

/**
 * v3 flip ticket. Front: the match ticket with the backend facts; back: the
 * backend QR (`qr_image`), dimmed and stamped when the backend status says it
 * can no longer be scanned. The flip is a 3D turn, or a plain swap under
 * reduced motion.
 */
function FlipTicket({ ticket, match }: { ticket: PortalTicket; match: PortalMatch }) {
  const theme = useTheme();
  const i18n = useI18n();
  const reducedMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const [turn] = useState(() => new Animated.Value(0));
  const state = ticketVisualState(ticket);
  const scannable = ticketIsScannable(state);
  const qr = ticketQrSource(ticket);
  const seat = ticketSeatFacts(ticket.seat);
  const date = formatDate(match.kickoff_at);
  const time = formatTime(match.kickoff_at);
  const status = stateLabel(i18n, state, ticket.status);

  useEffect(() => {
    if (reducedMotion) {
      turn.setValue(flipped ? 1 : 0);
      return;
    }
    Animated.timing(turn, { toValue: flipped ? 1 : 0, duration: 700, useNativeDriver: true }).start();
  }, [flipped, reducedMotion, turn]);

  const faceStyle = (back: boolean) =>
    reducedMotion
      ? { opacity: back === flipped ? 1 : 0 }
      : {
          opacity: turn.interpolate({ inputRange: [0, 0.5, 0.5001, 1], outputRange: back ? [0, 0, 1, 1] : [1, 1, 0, 0] }),
          transform: [
            { perspective: 1600 },
            { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: back ? ["180deg", "360deg"] : ["0deg", "180deg"] }) },
          ],
        };

  const note =
    state === "valid"
      ? i18n.t("myTickets.note.valid")
      : state === "used"
        ? ticket.checked_in_at
          ? i18n.t("myTickets.note.usedAt", { time: formatDateTime(ticket.checked_in_at) })
          : i18n.t("myTickets.note.used")
        : state === "cancelled"
          ? i18n.t("myTickets.note.cancelled")
          : state === "expired"
            ? i18n.t("myTickets.note.expired")
            : i18n.t("myTickets.note.other", { status });
  const noteTone = state === "valid" ? theme.colors.tones.success : state === "other" || state === "used" ? theme.colors.tones.neutral : theme.colors.tones.danger;

  const facts = (large: boolean) =>
    seat.row || seat.seat ? (
      <View style={local.facts}>
        {seat.row ? <Fact label={i18n.t("myTickets.row")} value={seat.row} large={large} /> : null}
        {seat.seat ? <Fact label={i18n.t("myTickets.seat")} value={seat.seat} large={large} /> : null}
      </View>
    ) : null;

  const holderRow = (
    <View style={[local.holderRow, { borderTopColor: theme.colors.hairline }]}>
      <View style={local.holderCopy}>
        <AppText variant="overline" tone="muted" style={local.factLabel}>{i18n.t("myTickets.holder")}</AppText>
        <AppText variant="bodyStrong" numberOfLines={1} style={local.holderName}>{ticket.holder_name}</AppText>
      </View>
      <View style={local.holderEnd}>
        <AppText variant="overline" tone="muted" numberOfLines={1} style={local.factLabel}>{ticket.zone.name}</AppText>
        <AppText variant="meta" style={local.mono}>{ticket.ticket_code}</AppText>
      </View>
    </View>
  );

  return (
    <View style={local.flip}>
      {/* Front */}
      <Animated.View
        style={[local.face, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowRaised }, faceStyle(false)]}
        pointerEvents={flipped ? "none" : "auto"}
        importantForAccessibility={flipped ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={flipped}
      >
        <View style={[local.ticketHero, { backgroundColor: theme.colors.hero }]}>
          <View style={{ opacity: scannable ? 1 : 0.4, ...local.fill }}>
            <PitchArt />
          </View>
          <View style={local.heroTop}>
            <View style={local.brand}>
              <View style={local.brandMark}>
                <Image source={require("../../assets/images/lfa-logo.png")} style={local.brandLogo} resizeMode="contain" accessible={false} />
              </View>
              <View style={local.brandCopy}>
                <AppText variant="overline" tone="onHeroMuted" style={local.official}>{i18n.t("myTickets.official")}</AppText>
                <AppText variant="meta" tone="onHero" numberOfLines={1}>{match.stadium ?? ""}</AppText>
              </View>
            </View>
            <View style={[local.statusPill, { backgroundColor: scannable ? "rgba(91,224,160,0.16)" : "rgba(255,255,255,0.14)" }]}>
              <View style={[local.statusDot, { backgroundColor: scannable ? "#5BE0A0" : "rgba(255,255,255,0.85)" }]} />
              <AppText variant="caption" style={{ color: scannable ? "#5BE0A0" : "rgba(255,255,255,0.85)", fontWeight: "600" }}>{status}</AppText>
            </View>
          </View>
          <View style={local.heroTeams}>
            <HeroTeam name={match.home_team.name} team={match.home_team} />
            <View style={local.heroCenter}>
              <AppText variant="displayScore" tone="onHero" align="center" numberOfLines={1} style={local.heroTime}>{time}</AppText>
              <AppText variant="caption" tone="onHeroMuted" align="center">{date}</AppText>
            </View>
            <HeroTeam name={match.away_team.name} team={match.away_team} />
          </View>
        </View>
        <TicketTear />
        {facts(true)}
        {holderRow}
        <View style={local.spacer} />
        <View style={local.faceAction}>
          <Button
            title={i18n.t("myTickets.showQr")}
            variant={scannable ? "primary" : "tonal"}
            onPress={() => setFlipped(true)}
            icon={<SymbolView name={{ ios: "qrcode", android: "qr_code_2", web: "qr_code_2" } as never} size={20} tintColor={scannable ? theme.colors.onActionPrimary : theme.colors.textStrong} fallback={<View />} />}
          />
        </View>
        <TicketTear />
        <View style={local.admit}>
          <AppText variant="displayDay" tone="muted" style={local.admitText}>{i18n.t("myTickets.admitOne")}</AppText>
          <AppText variant="caption" tone="muted" style={local.mono} numberOfLines={1}>{ticket.order_code}</AppText>
        </View>
      </Animated.View>

      {/* Back */}
      <Animated.View
        style={[local.face, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowRaised }, faceStyle(true)]}
        pointerEvents={flipped ? "auto" : "none"}
        importantForAccessibility={flipped ? "auto" : "no-hide-descendants"}
        accessibilityElementsHidden={!flipped}
      >
        <View style={[local.backHeader, { backgroundColor: theme.colors.hero }]}>
          <AppText variant="displayNumeral" tone="onHero" numberOfLines={1} style={local.backTitle}>
            {`${match.home_team.name} v ${match.away_team.name}`}
          </AppText>
          <AppText variant="caption" tone="onHeroMuted">{`${date} · ${time}`}</AppText>
        </View>
        <TicketTear />
        <View style={local.qrBlock}>
          <AppText variant="meta" tone="muted" align="center">
            {state === "valid"
              ? i18n.t("myTickets.qr.hintValid")
              : state === "other"
                ? i18n.t("myTickets.qr.hintOther")
                : i18n.t("myTickets.qr.hintBlocked")}
          </AppText>
          {/* Scannable geometry: never mirrored. */}
          <PhysicalLayout style={local.qrBox}>
            {qr ? (
              <Image
                source={{ uri: qr }}
                style={[local.qrImage, { opacity: state === "valid" || state === "other" ? 1 : 0.3 }]}
                resizeMode="contain"
                accessibilityLabel={i18n.t("myTickets.qr.a11y", { holder: ticket.holder_name })}
              />
            ) : (
              <AppText variant="meta" style={local.qrUnavailable}>{i18n.t("myTickets.qr.unavailable")}</AppText>
            )}
            {state === "used" || state === "expired" || state === "cancelled" ? (
              <View style={[local.stamp, { borderColor: state === "used" ? "#3B3D47" : "#C8102E" }]} accessible={false}>
                <AppText variant="bodyStrong" style={[local.stampText, { color: state === "used" ? "#3B3D47" : "#C8102E" }]}>
                  {i18n.t(`myTickets.state.${state}`)}
                </AppText>
              </View>
            ) : null}
          </PhysicalLayout>
          <View style={[local.note, { backgroundColor: noteTone.bg }]} accessibilityLiveRegion="polite">
            <AppText variant="meta" style={{ color: noteTone.fg }}>{note}</AppText>
          </View>
        </View>
        <View style={local.spacer} />
        {facts(false)}
        {holderRow}
        <View style={local.faceAction}>
          <Button
            title={i18n.t("myTickets.showDetails")}
            variant="tonal"
            onPress={() => setFlipped(false)}
            icon={<SymbolView name={{ ios: "arrow.triangle.2.circlepath", android: "flip", web: "flip" } as never} size={17} tintColor={theme.colors.textStrong} fallback={<View />} />}
          />
        </View>
      </Animated.View>
    </View>
  );
}

function HeroTeam({ name, team }: { name: string; team: PortalMatch["home_team"] }) {
  return (
    <View style={local.heroTeam}>
      <TeamCrest team={team} size={56} onHero />
      <AppText variant="displayCountdown" tone="onHero" align="center" numberOfLines={2} style={local.heroTeamName}>{name}</AppText>
    </View>
  );
}

function Fact({ label, value, large }: { label: string; value: string; large: boolean }) {
  return (
    <View style={local.fact}>
      <AppText variant="overline" tone="muted" style={local.factLabel}>{label}</AppText>
      <AppText variant={large ? "displaySection" : "displayDay"}>{value}</AppText>
    </View>
  );
}

/** v3 tear line with side notches (decorative). */
function TicketTear() {
  const theme = useTheme();
  return (
    <View style={local.tear} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={[local.tearNotch, local.tearStart, { backgroundColor: theme.colors.background }]} />
      <View style={[local.tearLine, { borderColor: theme.colors.border }]} />
      <View style={[local.tearNotch, local.tearEnd, { backgroundColor: theme.colors.background }]} />
    </View>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  filters: { marginTop: spacing.sm },
  list: { paddingTop: spacing.sm, paddingBottom: spacing.xxxl, gap: 10 },
  section: { gap: 10 },
  sectionHead: { paddingTop: spacing.lg, paddingHorizontal: spacing.xs },
  // v3 card: radius 20, grid 1fr | 86pt stub, dashed stub border, notches.
  card: { flexDirection: "row" as const, borderRadius: 20, minHeight: 104 },
  cardPast: { opacity: 0.72 },
  pressed: { opacity: 0.85 },
  cardMain: { flex: 1, minWidth: 0, paddingVertical: 14, paddingHorizontal: spacing.lg, gap: spacing.sm },
  cardTeams: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  crests: { flexDirection: "row" as const, flexShrink: 0 },
  crestOverlap: { marginStart: -4 },
  cardTitle: { flex: 1, minWidth: 0, fontSize: 16 },
  stub: {
    width: 86,
    borderStartWidth: 1.5,
    borderStyle: "dashed" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 2,
  },
  notch: { position: "absolute" as const, end: 78, width: 16, height: 16, borderRadius: 8 },
  notchTop: { top: -8 },
  notchBottom: { bottom: -8 },
  viewer: { flex: 1 },
  viewerHeader: { paddingHorizontal: layout.gutter },
  viewerHeaderBack: { width: "100%" as const, maxWidth: layout.readableWidth + layout.gutter * 2, alignSelf: "center" as const },
  viewerBody: { flex: 1, padding: layout.gutter, justifyContent: "center" as const },
  viewerScroll: { paddingTop: spacing.sm, paddingBottom: spacing.xxl, alignItems: "center" as const },
  viewerNotice: { width: "100%" as const, paddingHorizontal: layout.gutter, marginBottom: spacing.md },
  pager: { flexGrow: 0 },
  pagerControls: { flexDirection: "row" as const, alignItems: "center" as const, gap: 18, marginTop: spacing.lg },
  pagerButton: { width: size.touchTargetMin, height: size.touchTargetMin, borderRadius: 22, alignItems: "center" as const, justifyContent: "center" as const },
  dots: { flexDirection: "row" as const, gap: 5, alignItems: "center" as const },
  dot: { height: 6, borderRadius: 3 },
  // v3 ticket: 612pt card, radius 22 (sized to the content here, both faces equal).
  flip: { height: 600, width: "100%" as const, maxWidth: layout.readableWidth, alignSelf: "center" as const },
  face: {
    position: "absolute" as const,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 22,
    overflow: "hidden" as const,
    backfaceVisibility: "hidden" as const,
  },
  fill: { position: "absolute" as const, top: 0, bottom: 0, left: 0, right: 0 },
  ticketHero: { paddingTop: spacing.lg, paddingHorizontal: 18, paddingBottom: spacing.xl, overflow: "hidden" as const },
  heroTop: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 10 },
  brand: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, flex: 1, minWidth: 0 },
  brandMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#FFFFFF", alignItems: "center" as const, justifyContent: "center" as const },
  brandLogo: { width: 30, height: 30 },
  brandCopy: { flex: 1, minWidth: 0 },
  official: { fontSize: 10, letterSpacing: 1.4 },
  statusPill: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, minHeight: 26, paddingHorizontal: 10, borderRadius: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  heroTeams: { flexDirection: "row" as const, alignItems: "flex-start" as const, marginTop: spacing.xl, gap: spacing.sm },
  heroTeam: { flex: 1, minWidth: 0, alignItems: "center" as const, gap: spacing.sm },
  heroTeamName: { textTransform: "uppercase" as const },
  heroCenter: { alignItems: "center" as const, gap: 4, paddingTop: 6 },
  heroTime: { fontSize: 38, lineHeight: 42 },
  tear: { height: 24, flexDirection: "row" as const, alignItems: "center" as const },
  tearNotch: { width: 24, height: 24, borderRadius: 12 },
  tearStart: { marginStart: -12 },
  tearEnd: { marginEnd: -12 },
  tearLine: { flex: 1, borderTopWidth: 2, borderStyle: "dashed" as const, marginHorizontal: 8 },
  facts: { flexDirection: "row" as const, justifyContent: "space-around" as const, paddingHorizontal: 14, paddingTop: 2 },
  fact: { alignItems: "center" as const, gap: 3, minWidth: 64 },
  factLabel: { fontSize: 10, letterSpacing: 1 },
  holderRow: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "flex-end" as const,
    gap: spacing.md,
    marginTop: spacing.lg,
    marginHorizontal: 18,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  holderCopy: { flex: 1, minWidth: 0 },
  holderName: { fontSize: 16, marginTop: 3 },
  holderEnd: { alignItems: "flex-end" as const, flexShrink: 0, maxWidth: "50%" as const },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), letterSpacing: 0.4 },
  spacer: { flex: 1 },
  faceAction: { paddingHorizontal: 18, paddingVertical: 14 },
  admit: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, paddingHorizontal: 18, paddingBottom: spacing.lg, gap: spacing.md },
  admitText: { letterSpacing: 1.8, textTransform: "uppercase" as const },
  backHeader: { paddingVertical: 14, paddingHorizontal: 18, gap: 2 },
  backTitle: { textTransform: "uppercase" as const },
  qrBlock: { alignItems: "center" as const, gap: spacing.md, paddingHorizontal: 18 },
  // v3: 232pt white box, radius 18 (the scan surface stays light in both themes).
  qrBox: {
    width: 232,
    height: 232,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    boxShadow: "inset 0px 0px 0px 1px rgba(21,22,28,0.1)",
  },
  qrImage: { width: 200, height: 200 },
  qrUnavailable: { color: "#475569" },
  stamp: {
    position: "absolute" as const,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    borderWidth: 3,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.94)",
    transform: [{ rotate: "-9deg" }],
  },
  stampText: { fontSize: 20, letterSpacing: 2, textTransform: "uppercase" as const },
  note: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: spacing.sm },
};

export default withAuthRequired(TicketsScreen, "myTickets.title");
