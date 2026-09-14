import { MainHeader } from "@/components/MainHeader";
import { SheetDismissHandle } from "@/components/SheetDismissHandle";
import {
  Button,
  Empty,
  Loading,
  Screen,
  useResponsive,
  useTheme,
} from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { storageUrl } from "@/lib/config";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatTime,
} from "@/lib/format";
import { paymentDetail } from "@/lib/orderPresentation";
import { downloadProfileOrderPdf } from "@/lib/profilePdfDownload";
import { createRequestAuthority } from "@/lib/requestAuthority";
import {
  normalizeOrderIdentifier,
  profilePdfOrderIdentifier,
  resolveOrderDetailIdentifier,
  resolveTicketMatchId,
} from "@/lib/ticketActions";
import { backendProvidedError, userFacingError } from "@/lib/userFacingError";
import { getUserScopedCacheGeneration } from "@/lib/userScopedCache";
import { PdfDownloadHttpError, profileService } from "@/services/auth";
import type { PortalMatch } from "@/types";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import AnimatedBase from "react-native-reanimated";

type Item = Record<string, any>;
const Animated: any = AnimatedBase;
type MatchFilter = "all" | "upcoming" | "past";

function TicketsScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const toast = useToast();
  const responsive = useResponsive();
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [matches, setMatches] = useState<PortalMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PortalMatch | null>(null);
  const [tickets, setTickets] = useState<Item[]>([]);
  const [detailCache, setDetailCache] = useState<Record<string, Item>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [downloading, setDownloading] = useState(false);
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
        if (current()) setMatches(result.items);
      })
      .catch(() => {
        if (current()) {
          setMatches([]);
          setError("Could not load your matches. Please try again.");
        }
      })
      .finally(() => {
        if (current()) setLoading(false);
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
    setLoading(true);
    setError("");
    void load();
  };
  const changeFilter = (next: MatchFilter) => {
    if (next === filter) return;
    listRequest.invalidate();
    detailRequest.invalidate();
    setSelected(null);
    setMatches([]);
    setLoading(true);
    setError("");
    setFilter(next);
  };
  const filteredMatches = useMemo(
    () =>
      matches.filter((match) =>
        [portalMatchTitle(match), match.stadium ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [matches, query],
  );
  const openMatch = async (match: PortalMatch) => {
    const request = detailRequest.begin(String(match.match_id));
    const generation = getUserScopedCacheGeneration();
    const current = () =>
      detailRequest.isCurrent(request) &&
      generation === getUserScopedCacheGeneration();
    setSelected(match);
    setTickets([]);
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await profileService.tickets(match.match_id);
      if (!current()) return;
      const listed: Item[] = result.items.map((ticket) => ({
        ...ticket,
        match: {
          ...ticket.match,
          kickoff_at: match.kickoff_at,
          stadium: match.stadium,
        },
      }));
      setTickets(listed);
      const detailed = await Promise.all(
        listed.map(async (ticket) => {
          if (typeof ticket.qr_image === "string") return ticket;
          const code = text(ticket, ["ticket_code", "code", "reference"]);
          if (!code || !current()) return ticket;
          return { ...ticket, ...(await profileService.ticket(code)) };
        }),
      );
      if (current()) setTickets(detailed);
    } catch {
      if (current())
        setDetailError(
          "Some ticket details could not be loaded. Please try again.",
        );
    } finally {
      if (current()) setDetailLoading(false);
    }
  };
  const loadPayment = async (order: Item) => {
    const identifier = resolveOrderDetailIdentifier(order);

    if (!identifier) {
      return {
        ok: false,
        error:
          "This order does not include the information needed to load payment details.",
      };
    }

    const normalizedOrderId = normalizeOrderIdentifier(identifier);

    if (detailCache[normalizedOrderId]) {
      return { ok: true };
    }

    try {
      const detail = await profileService.order(normalizedOrderId);

      setDetailCache((current) => ({
        ...current,
        [normalizedOrderId]: detail,
      }));

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: backendProvidedError(
          err,
          "Could not load payment information. Please try again.",
        ),
      };
    }
  };
  const downloadPdf = async (order: Item) => {
    const identifier = profilePdfOrderIdentifier(order);
    if (!identifier || downloading) {
      if (!identifier)
        toast.showToast({
          variant: "error",
          title: "Could not download PDF",
          message: "Order number is required to download the PDF.",
        });
      return;
    }
    const normalizedOrderId = identifier.startsWith("ORD-")
      ? identifier.slice(4)
      : identifier;
    const generation = getUserScopedCacheGeneration();
    setDownloading(true);
    try {
      await downloadProfileOrderPdf(
        normalizedOrderId,
        () => generation === getUserScopedCacheGeneration(),
      );
    } catch (err) {
      if (generation === getUserScopedCacheGeneration())
        toast.showToast({
          variant: "error",
          title: "Could not download PDF",
          message:
            err instanceof PdfDownloadHttpError
              ? err.message
              : userFacingError(
                  err,
                  "Could not download the PDF. Please try again.",
                ),
        });
    } finally {
      if (generation === getUserScopedCacheGeneration()) setDownloading(false);
    }
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: "My Tickets" }} />
      <View style={[styles.shell, { width: responsive.contentWidth }]}>
        <MainHeader />
        <View style={{ flexDirection: "row", gap: 8, paddingVertical: 10 }}>
          {(["all", "upcoming", "past"] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === option }}
              onPress={() => changeFilter(option)}
              style={{
                flex: 1,
                minHeight: 48,
                justifyContent: "center",
                alignItems: "center",
                borderRadius: 12,
                borderWidth: 1,
                borderColor:
                  filter === option ? theme.colors.primary : theme.colors.line,
                backgroundColor: theme.colors.panel,
              }}
            >
              <Text
                style={{
                  color:
                    filter === option ? theme.colors.primary : theme.colors.ink,
                  fontWeight: "800",
                }}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
        <View
          style={[
            ticketStyles.filterBar,
            {
              backgroundColor: theme.colors.panel,
              borderColor: theme.colors.line,
            },
          ]}
        >
          <SymbolView
            name={{ ios: "magnifyingglass", android: "search", web: "search" }}
            size={19}
            tintColor={theme.colors.muted}
            fallback={<Text>⌕</Text>}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search matches"
            accessibilityLabel="Search matches"
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[ticketStyles.searchInput, { color: theme.colors.ink }]}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear match search"
              onPress={() => setQuery("")}
              style={ticketStyles.clearSearch}
            >
              <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={18} tintColor={theme.colors.muted} fallback={<View />} />
            </Pressable>
          ) : null}
        </View>
        {loading ? (
          <Loading />
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={false} onRefresh={reload} />
            }
          >
            {error ? (
              <View style={{ gap: 12 }}>
                <Empty title="Matches unavailable" detail={error} />
                <Button title="Try again" onPress={reload} />
              </View>
            ) : filteredMatches.length ? (
              filteredMatches.map((match) => (
                <Pressable
                  key={String(match.match_id)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    portalMatchTitle(match) || "View match tickets"
                  }
                  onPress={() => void openMatch(match)}
                  style={({ pressed }) => [
                    ticketStyles.order,
                    {
                      backgroundColor: theme.colors.panel,
                      borderColor: theme.colors.line,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <MatchIdentity item={{ match }} />
                  <View style={styles.matchMetadataRow}>
                    <Text
                      numberOfLines={1}
                      style={[theme.styles.muted, styles.matchDate]}
                    >
                      {formatDateTime(match.kickoff_at)}
                    </Text>
                    {match.stadium ? (
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[theme.styles.muted, styles.matchStadium]}
                      >
                        {match.stadium}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.matchMetadataRow}>
                    <Text
                      style={[styles.matchCount, { color: theme.colors.ink }]}
                    >
                      {match.ticket_count} Ticket
                      {match.ticket_count === 1 ? "" : "s"}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.matchAction,
                        { color: theme.colors.primary },
                      ]}
                    >
                      View Tickets
                    </Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <Empty
                title={
                  query
                    ? "No matching matches"
                    : filter === "all"
                      ? "No matches"
                      : "No " + filter + " matches"
                }
                detail={
                  query
                    ? "Try another team or stadium."
                    : "Matches with your tickets will appear here."
                }
              />
            )}
          </ScrollView>
        )}
      </View>
      <TicketModal
        key={selected ? String(selected.match_id) : "closed"}
        order={selected ? { match: portalMatchTicketContext(selected) } : null}
        tickets={tickets}
        selectedMatch={selected}
        loading={detailLoading}
        orderDetailCache={detailCache}
        error={detailError}
        onRetry={() => selected && void openMatch(selected)}
        downloading={downloading}
        onClose={() => {
          detailRequest.invalidate();
          setSelected(null);
        }}
        onLoadPayment={loadPayment}
        onDownload={downloadPdf}
      />
    </Screen>
  );
}

function TicketModal({
  order,
  tickets,
  selectedMatch,
  loading,
  orderDetailCache,
  error,
  onRetry,
  downloading,
  onClose,
  onLoadPayment,
  onDownload,
}: {
  order: Item | null;
  tickets: Item[];
  selectedMatch: PortalMatch | null;
  loading: boolean;
  orderDetailCache: Record<string, Item>;
  error: string;
  onRetry: () => void;
  downloading: boolean;
  onClose: () => void;
  onLoadPayment: (order: Item) => Promise<{ ok: boolean; error?: string }>;
  onDownload: (order: Item) => Promise<void>;
}) {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [actions, setActions] = useState(false);
  const [payment, setPayment] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // const width = useResponsive().contentWidth;
  const { width } = useWindowDimensions();
  if (!order) return null;
  const active = tickets[index] ?? tickets[0] ?? order;
  const activeOrder = ticketOrder(active);
  const activeOrderIdentifier = resolveOrderDetailIdentifier(activeOrder);
  const orderDetail = activeOrderIdentifier
    ? orderDetailCache[normalizeOrderIdentifier(activeOrderIdentifier)]
    : undefined;
  const activeOrderCode = text(active, ["order_code"]);
  const title = matchTitle(active);
  const venue = selectedMatch?.stadium ?? matchVenue(active);
  const seeMatch = () => {
    const id = resolveTicketMatchId(active, order);
    if (!id) return;
    onClose();
    requestAnimationFrame(() =>
      router.push({ pathname: "/match/[id]", params: { id } }),
    );
  };
  const showPayment = async () => {
    setActions(false);
    setPayment(true);
    setPaymentError(null);
    setPaymentLoading(true);
    const result = await onLoadPayment(activeOrder);
    if (!result.ok)
      setPaymentError(
        result.error ?? "Could not load payment information. Please try again.",
      );
    setPaymentLoading(false);
  };
  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close tickets" onPress={onClose} style={styles.backdrop}>
          <Pressable
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.ticketSheet,
              { backgroundColor: theme.colors.panel },
            ]}
          >
            <SheetDismissHandle onDismiss={onClose} color={theme.colors.muted} />
            <View style={styles.modalTop}>
              <Text style={[styles.position, { color: theme.colors.ink }]}>
                {tickets.length
                  ? `${index + 1} of ${tickets.length}`
                  : "Ticket"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close tickets"
                onPress={onClose}
                style={styles.close}
              >
                <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={21} tintColor={theme.colors.ink} fallback={<View />} />
              </Pressable>
            </View>
            {title || venue ? (
              <View style={styles.modalHeading}>
                {title ? (
                  <Text
                    style={[styles.modalTitle, { color: theme.colors.ink }]}
                  >
                    {title}
                  </Text>
                ) : null}
                {venue ? (
                  <Text style={[theme.styles.muted, styles.modalVenue]}>
                    ⌖ {venue}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {error ? (
              <View style={{ paddingHorizontal: 18, gap: 8 }}>
                <Text style={{ color: theme.colors.danger }}>{error}</Text>
                <Button title="Try again" onPress={onRetry} />
              </View>
            ) : null}
            {loading ? (
              <ActivityIndicator
                color={theme.colors.primary}
                style={styles.modalLoading}
              />
            ) : (
              <>
                {activeOrderCode ? (
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[theme.styles.muted, styles.activeOrderCode]}
                  >
                    Order {activeOrderCode}
                  </Text>
                ) : null}
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(event) => {
                    setIndex(
                      Math.round(event.nativeEvent.contentOffset.x / width),
                    );
                  }}
                  style={{ width }}
                  contentContainerStyle={styles.ticketPager}
                >
                  {tickets.length ? (
                    tickets.map((ticket, ticketIndex) => (
                      <View
                        key={text(
                          ticket,
                          ["ticket_code", "code", "reference"],
                          String(ticketIndex),
                        )}
                        style={{ width, paddingHorizontal: 18 }}
                      >
                        <FlipTicket ticket={ticket} />
                      </View>
                    ))
                  ) : (
                    <View style={{ width, paddingHorizontal: 18 }}>
                      {!error ? (
                        <Empty
                          title="No tickets"
                          detail="No tickets are available for this match."
                        />
                      ) : null}
                    </View>
                  )}
                </ScrollView>
              </>
            )}
            <View style={styles.actions}>
              <View style={styles.actionButton}>
                <Button
                  title="See Match"
                  disabled={!resolveTicketMatchId(active, order)}
                  onPress={seeMatch}
                />
              </View>
              <View style={styles.actionButton}>
                <Button
                  title="Actions"
                  variant="secondary"
                  onPress={() => setActions(true)}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={actions}
        transparent
        animationType="fade"
        onRequestClose={() => setActions(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close ticket actions"
          onPress={() => setActions(false)}
          style={styles.actionBackdrop}
        >
          <Pressable
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.actionSheet,
              { backgroundColor: theme.colors.panel },
            ]}
          >
            <SheetDismissHandle onDismiss={() => setActions(false)} color={theme.colors.muted} />
            <View style={ticketStyles.actionSheetHeader}>
              <Text
                style={[
                  ticketStyles.actionSheetTitle,
                  { color: theme.colors.ink },
                ]}
              >
                Actions
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close actions"
                onPress={() => setActions(false)}
                style={styles.close}
              >
                <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={20} tintColor={theme.colors.ink} fallback={<View />} />
              </Pressable>
            </View>
            <Action
              title="Payment Info"
              icon={{ ios: "creditcard", android: "receipt", web: "receipt" }}
              onPress={() => void showPayment()}
            />
            <Action
              title={downloading ? "Downloading..." : "Download PDF"}
              icon={{
                ios: "arrow.down.doc",
                android: "download",
                web: "download",
              }}
              disabled={downloading}
              onPress={() => {
                setActions(false);
                void onDownload(activeOrder);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={payment}
        transparent
        animationType="fade"
        onRequestClose={() => setPayment(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close payment information"
          onPress={() => setPayment(false)}
          style={styles.actionBackdrop}
        >
          <Pressable
            accessibilityViewIsModal
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.paymentSheet,
              { backgroundColor: theme.colors.panel },
            ]}
          >
            <SheetDismissHandle onDismiss={() => setPayment(false)} color={theme.colors.muted} />
            <Text style={[styles.modalTitle, { color: theme.colors.ink }]}>
              Payment Info
            </Text>
            {paymentLoading ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : null}
            {paymentError ? (
              <View
                style={[
                  ticketStyles.inlineError,
                  { backgroundColor: theme.colors.panelSoft },
                ]}
              >
                <Text style={{ color: theme.colors.danger }}>
                  {paymentError}
                </Text>
              </View>
            ) : null}
            {orderDetail && !paymentError ? (
              <PaymentInfo item={orderDetail} />
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPayment(false)} style={styles.close}>
              <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={20} tintColor={theme.colors.ink} fallback={<View />} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function FlipTicket({ ticket }: { ticket: Item }) {
  const theme = useTheme();
  const [back, setBack] = useState(false);
  const transition = {
    transitionProperty: ["opacity", "transform"],
    transitionDuration: 320,
  } as const;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={back ? "Show ticket information" : "Show QR code"}
      onPress={() => setBack((value) => !value)}
      style={styles.flipPress}
    >
      <Animated.View
        style={[
          styles.face,
          {
            backgroundColor: theme.colors.panelSoft,
            borderColor: theme.colors.line,
            opacity: back ? 0 : 1,
            transform: [
              { perspective: 900 },
              { rotateY: back ? "180deg" : "0deg" },
            ],
          },
          transition,
        ]}
      >
        <View style={ticketStyles.faceContent}>
          <View style={ticketStyles.centeredFaceContent}>
            <TicketInfo ticket={ticket} />
          </View>

          <Text
            style={[ticketStyles.flipHint, { color: theme.colors.primary }]}
          >
            Tap to see QR code
          </Text>
        </View>
      </Animated.View>
      <Animated.View
        style={[
          styles.face,
          styles.backFace,
          {
            backgroundColor: "#fff",
            borderColor: theme.colors.line,
            opacity: back ? 1 : 0,
            transform: [
              { perspective: 900 },
              { rotateY: back ? "360deg" : "180deg" },
            ],
          },
          transition,
        ]}
      >
        <View style={ticketStyles.faceContent}>
          <View style={ticketStyles.centeredFaceContent}>
            <View style={ticketStyles.backCenter}>
              {typeof ticket.qr_image === "string" &&
              ticket.qr_image.startsWith("data:image/") ? (
                <Image
                  source={{ uri: ticket.qr_image }}
                  style={styles.qr}
                  resizeMode="contain"
                />
              ) : (
                <Text style={{ color: "#475569" }}>QR unavailable</Text>
              )}
              <Text style={styles.holder}>
                {text(
                  ticket,
                  ["holder_name", "ticket_holder_name", "name"],
                  "",
                )}
              </Text>
              <Text style={styles.reference}>
                {text(ticket, ["ticket_code", "code", "reference"], "")}
              </Text>
            </View>
            {/* <View style={ticketStyles.flexRegion} /> */}
          </View>

          <Text style={[ticketStyles.flipHint, { color: "#C8102E" }]}>
            Tap to see ticket info
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}
function MatchIdentity({
  item,
  compact = false,
}: {
  item: Item;
  compact?: boolean;
}) {
  const theme = useTheme();
  const match = record(item.match);
  const home = teamData(match.home_team, match.home_team_logo);
  const away = teamData(match.away_team, match.away_team_logo);
  const title =
    matchTitle(item) ||
    text(item, ["match_name", "event_name"], "") ||
    text(match, ["title", "name"], "");
  if (!home && !away && !title) return null;
  return (
    <View
      style={[
        ticketStyles.matchIdentity,
        compact && ticketStyles.matchIdentityCompact,
      ]}
    >
      {home ? <TeamMark team={home} compact={compact} /> : null}
      <View style={ticketStyles.vsBlock}>
        {home && away ? (
          <Text style={[ticketStyles.vsText, { color: theme.colors.muted }]}>
            VS
          </Text>
        ) : null}
        {/* {title ? (
          <Text
            numberOfLines={2}
            style={[ticketStyles.matchTitle, { color: theme.colors.ink }]}
          >
            {title}
          </Text>
        ) : null} */}
      </View>
      {away ? <TeamMark team={away} compact={compact} /> : null}
    </View>
  );
}
function TeamMark({
  team,
  compact,
}: {
  team: { name: string; short: string; logo?: string };
  compact?: boolean;
}) {
  const theme = useTheme();
  const logo = storageUrl(team.logo);
  return (
    <View style={ticketStyles.team}>
      <View
        style={[
          ticketStyles.teamLogo,
          compact && ticketStyles.teamLogoCompact,
          {
            backgroundColor: theme.colors.panel,
            borderColor: theme.colors.line,
          },
        ]}
      >
        {logo ? (
          <Image
            source={{ uri: logo }}
            style={ticketStyles.teamLogoImage}
            resizeMode="contain"
          />
        ) : (
          <Text
            style={[ticketStyles.teamInitial, { color: theme.colors.primary }]}
          >
            {team.short}
          </Text>
        )}
      </View>
      <Text
        numberOfLines={2}
        style={[ticketStyles.teamName, { color: theme.colors.secondary }]}
      >
        {team.name}
      </Text>
    </View>
  );
}
function TicketInfo({ ticket }: { ticket: Item }) {
  const theme = useTheme();
  const match = record(ticket.match);
  const zone = record(ticket.zone);
  const seat = record(ticket.seat);
  const status = text(ticket, ["status"]);
  const displayStatus = status
    ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
    : "";
  const fields = [
    ["Date", match.match_date ? formatDate(match.match_date) : ""],
    ["Time", match.kickoff_at ? formatTime(match.kickoff_at) : ""],
    ["Stadium", matchVenue(ticket)],
    [
      "Zone",
      text(ticket, ["zone_name", "section", "zone"], text(zone, ["name"], "")),
    ],
    ["Row", text(ticket, ["row", "seat_row"], text(seat, ["row"], ""))],
    [
      "Seat",
      text(
        ticket,
        ["seat", "seat_number", "number"],
        text(seat, ["label", "number"], ""),
      ),
    ],
  ].filter(([, value]) => value);
  return (
    <View style={ticketStyles.ticketInfo}>
      <View style={ticketStyles.matchZone}>
        <MatchIdentity item={ticket} compact />
      </View>
      <View style={ticketStyles.detailsZone}>
        {fields.map(([label, value]) => (
          <View key={label} style={styles.field}>
            <Text style={theme.styles.muted}>{label}</Text>
            <Text style={[styles.fieldValue, { color: theme.colors.ink }]}>
              {value}
            </Text>
          </View>
        ))}
        {displayStatus ? (
          <View
            style={[
              ticketStyles.ticketStatusBadge,
              {
                backgroundColor:
                  status.toLowerCase() === "valid"
                    ? theme.colors.success
                    : theme.colors.panelSoft,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                ticketStyles.ticketStatusText,
                {
                  color:
                    status.toLowerCase() === "valid"
                      ? "#FFFFFF"
                      : theme.colors.muted,
                },
              ]}
            >
              {displayStatus}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
function PaymentInfo({ item }: { item: Item }) {
  const theme = useTheme();
  const detail = paymentDetail(item);
  if (!detail) return null;
  const rows = [
    ["Order reference", detail.orderReference ?? ""],
    ["Payment reference", detail.paymentReference ?? ""],
    ["Payment method", paymentMethod(detail.paymentMethod ?? "")],
    [
      "Total",
      detail.total !== undefined && detail.total !== null
        ? formatMoney(detail.total, detail.currency ?? "USD")
        : "",
    ],
    ["Currency", detail.currency ?? ""],
    ["Paid at", detail.paidAt ? formatDateTime(detail.paidAt) : ""],
  ].filter(([, value]) => value);
  return (
    <View>
      {rows.map(([label, value]) => (
        <View key={String(label)} style={styles.paymentRow}>
          <Text style={theme.styles.muted}>{String(label)}</Text>
          <Text style={[styles.fieldValue, { color: theme.colors.ink }]}>
            {String(value)}
          </Text>
        </View>
      ))}
    </View>
  );
}
function Action({
  title,
  icon,
  onPress,
  disabled,
}: {
  title: string;
  icon: any;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={styles.actionRow}
    >
      <SymbolView
        name={icon}
        size={20}
        tintColor={theme.colors.primary}
        fallback={<Text>{title[0]}</Text>}
      />
      <Text style={[styles.actionText, { color: theme.colors.ink }]}>
        {title}
      </Text>
    </Pressable>
  );
}
function isRecord(value: unknown): value is Item {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Item {
  return isRecord(value) ? value : {};
}
function text(item: Item, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return fallback;
}
function ticketOrder(ticket: Item): Item {
  if (isRecord(ticket.order)) return ticket.order;
  // Ticket IDs and match IDs are never order IDs.
  return {
    order_number: ticket.order_number ?? ticket.order_code,
    order_code: ticket.order_code,
  };
}

function portalMatchTitle(match: PortalMatch) {
  return `${match.home_team.name} vs ${match.away_team.name}`;
}

function portalMatchTicketContext(match: PortalMatch): Item {
  return {
    id: match.match_id,
    match_id: match.match_id,
    kickoff_at: match.kickoff_at,
    status: match.status,
    home_team: match.home_team,
    away_team: match.away_team,
    stadium: match.stadium,
  };
}

function matchTitle(item: Item) {
  const match = record(item.match);
  const home =
    typeof match.home_team === "string"
      ? match.home_team
      : text(record(match.home_team), ["name"]);
  const away =
    typeof match.away_team === "string"
      ? match.away_team
      : text(record(match.away_team), ["name"]);
  return home && away ? `${home} vs ${away}` : "";
}
function matchVenue(item: Item) {
  const match = record(item.match);
  const venue = match.stadium ?? match.venue ?? match.location;
  return typeof venue === "string"
    ? venue
    : text(record(venue), ["name", "title"]);
}
function teamData(value: unknown, ticketLogo?: unknown) {
  if (typeof value === "string" && value.trim())
    return {
      name: value.trim(),
      short: value.trim().slice(0, 3).toUpperCase(),
      logo:
        typeof ticketLogo === "string" && ticketLogo.trim()
          ? ticketLogo.trim()
          : undefined,
    };
  const team = record(value);
  const name = text(team, ["name"], "");
  if (!name) return null;
  return {
    name,
    short: text(team, ["short_name"], name.slice(0, 3).toUpperCase()),
    logo: text(team, ["logo"], "") || undefined,
  };
}
function paymentMethod(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "blue") return "Blue Wallet";
  if (normalized === "cash") return "Cash";
  if (normalized) return "Card";
  return "";
}
const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignSelf: "center",
  },
  pageTitle: {
    paddingTop: 18,
    paddingBottom: 8,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
  },
  list: {
    paddingTop: 8,
    paddingBottom: 30,
  },
  order: {
    minHeight: 96,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  matchMetadataRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minWidth: 0,
  },
  matchDate: {
    flexShrink: 1,
    minWidth: 0,
  },
  matchStadium: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
  },
  matchCount: {
    flexShrink: 1,
    minWidth: 0,
    fontWeight: "800",
  },
  matchAction: {
    flexShrink: 0,
    fontWeight: "800",
  },
  countBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  countNumber: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "900",
  },
  countLabel: {
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  orderCopy: {
    flex: 1,
    gap: 3,
  },
  orderTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
  },
  orderMeta: {
    fontSize: 13,
    fontWeight: "700",
  },
  chevron: {
    fontSize: 26,
  },
  pressed: {
    opacity: 0.68,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.62)",
  },
  ticketSheet: {
    maxHeight: "96%",
    minHeight: "82%",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 10,
    overflow: "hidden",
  },
  dragHandle: {
    width: 52,
    height: 5,
    opacity: 0.45,
    borderRadius: 999,
    alignSelf: "center",
    marginBottom: 4,
  },
  modalTop: {
    minHeight: 44,
    paddingHorizontal: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalHeading: {
    alignItems: "center",
    paddingHorizontal: 34,
    gap: 5,
    marginBottom: 6,
  },
  position: {
    fontSize: 16,
    fontWeight: "900",
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "900",
    textAlign: "center",
  },
  modalVenue: {
    textAlign: "center",
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  modalLoading: {
    flex: 1,
  },
  activeOrderCode: {
    maxWidth: "100%",
    paddingHorizontal: 18,
    fontSize: 13,
    fontWeight: "700",
  },
  ticketPager: {
    alignItems: "center",
  },
  flipPress: {
    height: 410,
    position: "relative",
  },
  face: {
    position: "absolute",
    inset: 0,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    backfaceVisibility: "hidden",
    // justifyContent: "center"
  },
  backFace: { alignItems: "center" },
  info: { gap: 12 },
  teams: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "900",
    marginBottom: 10,
    textAlign: "center",
  },
  field: {
    minHeight: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  fieldValue: { fontSize: 14, fontWeight: "800", textAlign: "right" },
  flipHint: {
    position: "absolute",
    bottom: 17,
    alignSelf: "center",
    fontSize: 12,
    fontWeight: "800",
  },
  qr: { width: 250, height: 250, maxWidth: "90%" },
  holder: { color: "#0F172A", fontSize: 17, fontWeight: "900", marginTop: 10 },
  reference: { color: "#64748B", fontSize: 12, marginTop: 3 },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 2,
  },
  actionButton: { flex: 1 },
  actionBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.45)",
  },
  actionSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    gap: 4,
  },
  actionRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
  },
  actionText: { fontSize: 16, fontWeight: "800" },
  paymentSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    gap: 14,
  },
  paymentRow: {
    minHeight: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
});
const ticketStyles = StyleSheet.create({
  filterBar: {
    minHeight: 48,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  searchInput: { flex: 1, minHeight: 46, fontSize: 14 },
  clearSearch: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  order: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 15,
    gap: 13,
    marginBottom: 12,
  },
  orderHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  orderHeading: { flex: 1, gap: 3 },
  orderReference: { fontSize: 17, fontWeight: "900" },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  orderMetrics: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 11,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metricValue: { fontSize: 16, fontWeight: "900" },
  metricEnd: { alignItems: "flex-end" },
  contains: { gap: 4 },
  containsLabel: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  summaryText: { fontSize: 13, fontWeight: "700" },
  moreText: { fontSize: 12, fontWeight: "800" },
  matchIdentity: {
    minHeight: 100,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  matchIdentityCompact: { minHeight: 86 },
  team: { flex: 1, minWidth: 0, alignItems: "center", gap: 6 },
  teamLogo: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  teamLogoCompact: { width: 72, height: 72 },
  teamLogoImage: { width: "82%", height: "82%" },
  teamInitial: { fontSize: 16, fontWeight: "900" },
  teamName: {
    minHeight: 40,
    fontSize: 15,
    lineHeight: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  vsBlock: { flex: 1.4, minWidth: 0, alignItems: "center", gap: 5 },
  vsText: { fontSize: 10, fontWeight: "900" },
  matchTitle: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    textAlign: "center",
  },
  // faceContent: { flex: 1, width: "100%" },
  // flexRegion: { flexGrow: 1, minHeight: 6 },
  backCenter: { width: "100%", alignItems: "center" },
  // flipHint: { minHeight: 36, alignSelf: "center", textAlignVertical: "center", fontSize: 12, fontWeight: "800" },
  ticketInfo: { width: "100%", gap: 12 },
  matchZone: { justifyContent: "center" },
  detailsZone: { justifyContent: "center", gap: 7 },
  ticketStatusBadge: {
    alignSelf: "center",
    maxWidth: "100%",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  ticketStatusText: { fontSize: 11, fontWeight: "800" },
  inlineError: { borderRadius: 10, padding: 12 },
  actionSheetHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionSheetTitle: { fontSize: 20, fontWeight: "900" },
  faceContent: {
    flex: 1,
    width: "100%",
    position: "relative",
  },
  centeredFaceContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 36,
  },
  flipHint: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 36,
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 12,
    fontWeight: "800",
  },
});

export default withAuthRequired(TicketsScreen);
