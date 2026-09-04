import { AuthRequired } from "@/components/AuthRequired";
import { MainHeader } from "@/components/MainHeader";
import { Button, Empty, Loading, Screen, useResponsive, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { storageUrl } from "@/lib/config";
import { formatDate, formatDateTime, formatMoney, formatTime } from "@/lib/format";
import { filterOrders, orderMatchSummaries, paymentDetail } from "@/lib/orderPresentation";
import { downloadProfileOrderPdf } from "@/lib/profilePdfDownload";
import { profilePdfOrderIdentifier, resolveOrderDetailIdentifier, resolveTicketMatchId } from "@/lib/ticketActions";
import { userFacingError } from "@/lib/userFacingError";
import { UserScopedCache, getUserScopedCacheGeneration } from "@/lib/userScopedCache";
import { profileService } from "@/services/auth";
import type { Order } from "@/types";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import AnimatedBase from "react-native-reanimated";

type Item = Record<string, any>;
const Animated: any = AnimatedBase;
type TicketListData = { orders: Order[]; tickets: Item[] };
const ticketListCache = new UserScopedCache<TicketListData>();

export default function TicketsScreen() {
  const auth = useAuth(); const theme = useTheme(); const toast = useToast(); const responsive = useResponsive();
  const ownerKey = auth.isAuthenticated ? auth.userCacheKey : null;
  const initialData = ticketListCache.get(ownerKey);
  const [orders, setOrders] = useState<Order[]>(initialData?.orders ?? []); const [tickets, setTickets] = useState<Item[]>(initialData?.tickets ?? []); const [renderedOwnerKey, setRenderedOwnerKey] = useState<string | null>(initialData ? ownerKey : null); const [loading, setLoading] = useState(Boolean(ownerKey && !initialData)); const [refreshing, setRefreshing] = useState(false); const [query, setQuery] = useState(""); const [selected, setSelected] = useState<Item | null>(null); const [ticketCache, setTicketCache] = useState<Record<string, Item[]>>({}); const [detailCache, setDetailCache] = useState<Record<string, Item>>({}); const [detailLoading, setDetailLoading] = useState(false); const [downloading, setDownloading] = useState(false);
  const load = useCallback(async (force = false) => { if (!ownerKey) { setLoading(false); return; } const cached = force ? null : ticketListCache.get(ownerKey); if (cached) { setOrders(cached.orders); setTickets(cached.tickets); setRenderedOwnerKey(ownerKey); setLoading(false); setRefreshing(false); return; } const generation = getUserScopedCacheGeneration(); try { const [nextOrders, nextTickets] = await Promise.all([profileService.orders(), profileService.tickets()]); if (generation !== getUserScopedCacheGeneration()) return; const nextData = { orders: nextOrders.items, tickets: nextTickets.items }; if (ticketListCache.set(ownerKey, nextData)) { setOrders(nextData.orders); setTickets(nextData.tickets); setRenderedOwnerKey(ownerKey); } } catch (err) { if (generation === getUserScopedCacheGeneration()) toast.showToast({ variant: "error", title: "Could not load tickets", message: userFacingError(err, "Could not load your tickets. Please try again.") }); } finally { if (generation === getUserScopedCacheGeneration()) { setLoading(false); setRefreshing(false); } } }, [ownerKey, toast]);
  useEffect(() => { const timeout = setTimeout(() => { setSelected(null); setTicketCache({}); setDetailCache({}); const cached = ticketListCache.get(ownerKey); if (cached) { setOrders(cached.orders); setTickets(cached.tickets); setRenderedOwnerKey(ownerKey); setLoading(false); return; } setOrders([]); setTickets([]); setRenderedOwnerKey(null); setLoading(Boolean(ownerKey)); void load(); }, 0); return () => clearTimeout(timeout); }, [load, ownerKey]);
  const visibleOrders = useMemo(() => renderedOwnerKey === ownerKey ? orders : [], [orders, ownerKey, renderedOwnerKey]);
  const visibleTickets = useMemo(() => renderedOwnerKey === ownerKey ? tickets : [], [ownerKey, renderedOwnerKey, tickets]);
  const paidOrders = useMemo(() => visibleOrders.filter((order) => isPaid(order as Item)), [visibleOrders]);
  const ticketsFor = useCallback((order: Item) => { const embedded = Array.isArray(order.tickets) ? order.tickets.filter(isRecord) : []; if (embedded.length) return embedded; const reference = orderReference(order); return visibleTickets.filter((ticket) => reference && orderReference(ticket) === reference); }, [visibleTickets]);
  const filteredOrders = useMemo(() => filterOrders(paidOrders, query, (order) => ticketsFor(order as Item)), [paidOrders, query, ticketsFor]);
  const openOrder = async (order: Item) => { const key = orderReference(order); if (!key) return; setSelected(order); if (ticketCache[key]) return; const listed = ticketsFor(order); setDetailLoading(true); try { const detailed = await Promise.all(listed.map(async (ticket) => { if (typeof ticket.qr_image === "string") return ticket; const code = text(ticket, ["ticket_code", "code", "reference"]); return code ? await profileService.ticket(code) : ticket; })); setTicketCache((current) => ({ ...current, [key]: detailed })); } catch (err) { setTicketCache((current) => ({ ...current, [key]: listed })); toast.showToast({ variant: "error", title: "Ticket details unavailable", message: userFacingError(err, "Some ticket details could not be loaded. Please try again.") }); } finally { setDetailLoading(false); } };
  const loadPayment = async (order: Item) => { const key = resolveOrderDetailIdentifier(order); if (!key) return { ok: false, error: "This order does not include the information needed to load payment details." }; if (detailCache[key]) return { ok: true }; try { const detail = await profileService.order(key); setDetailCache((current) => ({ ...current, [key]: detail })); return { ok: true }; } catch (err) { return { ok: false, error: userFacingError(err, "Could not load payment information. Please try again.") }; } };
  const downloadPdf = async (order: Item) => { const identifier = profilePdfOrderIdentifier(order); if (!identifier || downloading) { if (!identifier) toast.showToast({ variant: "error", title: "Could not download PDF", message: "Order number is required to download the PDF." }); return; } const generation = getUserScopedCacheGeneration(); setDownloading(true); try { await downloadProfileOrderPdf(identifier, () => generation === getUserScopedCacheGeneration()); } catch (err) { if (generation === getUserScopedCacheGeneration()) toast.showToast({ variant: "error", title: "Could not download PDF", message: userFacingError(err, "Could not download the PDF. Please try again.") }); } finally { if (generation === getUserScopedCacheGeneration()) setDownloading(false); } };
  if (!auth.isReady) return <Loading />;
  if (!auth.isAuthenticated) return <Screen><View style={[styles.shell, { width: responsive.contentWidth }]}><MainHeader /><Text style={[theme.styles.title, styles.pageTitle]}>My Tickets</Text><AuthRequired /></View></Screen>;
  const awaitingOwner = loading || renderedOwnerKey !== ownerKey;
  return <Screen><Stack.Screen options={{ title: "My Tickets" }} /><View style={[styles.shell, { width: responsive.contentWidth }]}><MainHeader />{awaitingOwner ? <Loading /> : <><View style={[ticketStyles.filterBar, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}><SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={19} tintColor={theme.colors.muted} fallback={<Text>⌕</Text>} /><TextInput value={query} onChangeText={setQuery} placeholder="Search orders or matches" placeholderTextColor={theme.colors.muted} autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel="Search orders" style={[ticketStyles.searchInput, { color: theme.colors.ink }]} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear order search" onPress={() => setQuery("")} style={ticketStyles.clearSearch}><Text style={{ color: theme.colors.muted, fontSize: 20 }}>×</Text></Pressable> : null}</View><ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} />} contentContainerStyle={styles.list}>{filteredOrders.length ? filteredOrders.map((order) => { const item = order as Item; const related = ticketsFor(item); return <OrderCard key={orderReference(item)} order={item} tickets={related} onPress={() => void openOrder(item)} />; }) : <Empty title={query ? "No matching orders" : "No paid orders"} detail={query ? "Try another order number, status, or match." : "Paid ticket orders will appear here."} />}</ScrollView></>}</View><TicketModal key={selected ? orderReference(selected) : "closed"} order={selected} tickets={selected ? (ticketCache[orderReference(selected)] ?? ticketsFor(selected)) : []} loading={detailLoading} orderDetail={selected ? detailCache[resolveOrderDetailIdentifier(selected) ?? ""] : undefined} downloading={downloading} onClose={() => setSelected(null)} onLoadPayment={loadPayment} onDownload={downloadPdf} /></Screen>;
}

function TicketModal({
  order,
  tickets,
  loading,
  orderDetail,
  downloading,
  onClose,
  onLoadPayment,
  onDownload,
}: {
  order: Item | null;
  tickets: Item[];
  loading: boolean;
  orderDetail?: Item;
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
  const title = matchTitle(active);
  const venue = matchVenue(active);
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
    const result = await onLoadPayment(order);
    if (!result.ok)
      setPaymentError(
        result.error ?? "Could not load payment information. Please try again.",
      );
    setPaymentLoading(false);
  };
  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <View
            accessibilityViewIsModal
            style={[
              styles.ticketSheet,
              { backgroundColor: theme.colors.panel },
            ]}
          >
            <View
              style={[
                styles.dragHandle,
                { backgroundColor: theme.colors.muted },
              ]}
            />
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
                <Text
                  style={{
                    color: theme.colors.ink,
                    fontSize: 28,
                    lineHeight: 30,
                  }}
                >
                  ×
                </Text>
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
            {loading ? (
              <ActivityIndicator
                color={theme.colors.primary}
                style={styles.modalLoading}
              />
            ) : (
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
                    <FlipTicket ticket={active} />
                  </View>
                )}
              </ScrollView>
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
          </View>
        </View>
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
                <Text style={{ color: theme.colors.ink, fontSize: 26 }}>×</Text>
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
                void onDownload(order);
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
            <Button
              title="Close"
              variant="secondary"
              onPress={() => setPayment(false)}
            />
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
                {text(ticket, ["holder_name", "ticket_holder_name", "name"], "")}
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
function OrderCard({
  order,
  tickets,
  onPress,
}: {
  order: Item;
  tickets: Item[];
  onPress: () => void;
}) {
  const theme = useTheme();
  const count =
    tickets.length ||
    numeric(order, ["tickets_count", "ticket_count"]) ||
    (Array.isArray(order.tickets) ? order.tickets.length : 0);
  const summaries = orderMatchSummaries(order, tickets);
  const reference = text(
    order,
    ["order_code", "order_number", "reference"],
    "Order",
  );
  const status = text(order, ["status"], "");
  const date = text(order, ["paid_at", "created_at"], "");
  const total =
    order.total !== undefined
      ? formatMoney(order.total, text(order, ["currency"], "USD"))
      : "";
  const method = paymentMethod(text(order, ["payment_method"], ""));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open order ${reference}`}
      onPress={onPress}
      style={({ pressed }) => [
        ticketStyles.order,
        { backgroundColor: theme.colors.panel, borderColor: theme.colors.line },
        pressed && styles.pressed,
      ]}
    >
      <View style={ticketStyles.orderHeader}>
        <View style={ticketStyles.orderHeading}>
          <Text
            style={[ticketStyles.orderReference, { color: theme.colors.ink }]}
          >
            Order {reference}
          </Text>
          {date ? (
            <Text style={theme.styles.muted}>
              {status ? `${status} · ` : ""}
              {formatDateTime(date)}
            </Text>
          ) : status ? (
            <Text style={theme.styles.muted}>{status}</Text>
          ) : null}
        </View>
        {status ? (
          <View
            style={[
              ticketStyles.statusBadge,
              { backgroundColor: theme.colors.panelSoft },
            ]}
          >
            <Text
              style={[ticketStyles.statusText, { color: theme.colors.primary }]}
            >
              {status}
            </Text>
          </View>
        ) : null}
      </View>
      <View
        style={[ticketStyles.orderMetrics, { borderColor: theme.colors.line }]}
      >
        <View>
          <Text style={[ticketStyles.metricValue, { color: theme.colors.ink }]}>
            {count}
          </Text>
          <Text style={theme.styles.muted}>Ticket{count === 1 ? "" : "s"}</Text>
        </View>
        {total ? (
          <View style={ticketStyles.metricEnd}>
            <Text
              style={[ticketStyles.metricValue, { color: theme.colors.ink }]}
            >
              {total}
            </Text>
            {method ? <Text style={theme.styles.muted}>{method}</Text> : null}
          </View>
        ) : null}
      </View>
      {summaries.length ? (
        <View style={ticketStyles.contains}>
          <Text
            style={[ticketStyles.containsLabel, { color: theme.colors.muted }]}
          >
            Contains
          </Text>
          {summaries.slice(0, 2).map((summary) => (
            <Text
              key={summary}
              numberOfLines={1}
              style={[
                ticketStyles.summaryText,
                { color: theme.colors.secondary },
              ]}
            >
              {summary}
            </Text>
          ))}
          {summaries.length > 2 ? (
            <Text
              style={[ticketStyles.moreText, { color: theme.colors.primary }]}
            >
              +{summaries.length - 2} more
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
function MatchIdentity({ item, compact = false }: { item: Item; compact?: boolean }) { const theme = useTheme(); const match = record(item.match); const home = teamData(match.home_team); const away = teamData(match.away_team); const title = matchTitle(item) || text(item, ["match_name", "event_name"], "") || text(match, ["title", "name"], ""); if (!home && !away && !title) return null; return <View style={[ticketStyles.matchIdentity, compact && ticketStyles.matchIdentityCompact]}>{home ? <TeamMark team={home} compact={compact} /> : null}<View style={ticketStyles.vsBlock}>{home && away ? <Text style={[ticketStyles.vsText, { color: theme.colors.muted }]}>VS</Text> : null}{title ? <Text numberOfLines={2} style={[ticketStyles.matchTitle, { color: theme.colors.ink }]}>{title}</Text> : null}</View>{away ? <TeamMark team={away} compact={compact} /> : null}</View>; }
function TeamMark({ team, compact }: { team: { name: string; short: string; logo?: string }; compact?: boolean }) { const theme = useTheme(); const logo = storageUrl(team.logo); return <View style={ticketStyles.team}><View style={[ticketStyles.teamLogo, compact && ticketStyles.teamLogoCompact, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>{logo ? <Image source={{ uri: logo }} style={ticketStyles.teamLogoImage} resizeMode="contain" /> : <Text style={[ticketStyles.teamInitial, { color: theme.colors.primary }]}>{team.short}</Text>}</View><Text numberOfLines={2} style={[ticketStyles.teamName, { color: theme.colors.secondary }]}>{team.name}</Text></View>; }
function TicketInfo({ ticket }: { ticket: Item }) { const theme = useTheme(); const match = record(ticket.match); const zone = record(ticket.zone); const seat = record(ticket.seat); const fields = [["Date", match.match_date ? formatDate(match.match_date) : ""], ["Time", match.kickoff_at ? formatTime(match.kickoff_at) : ""], ["Stadium", matchVenue(ticket)], ["Zone", text(ticket, ["zone_name", "section", "zone"], text(zone, ["name"], ""))], ["Row", text(ticket, ["row", "seat_row"], text(seat, ["row"], ""))], ["Seat", text(ticket, ["seat", "seat_number", "number"], text(seat, ["label", "number"], ""))]].filter(([, value]) => value); return <View style={ticketStyles.ticketInfo}><View style={ticketStyles.matchZone}><MatchIdentity item={ticket} compact /></View><View style={ticketStyles.detailsZone}>{fields.map(([label, value]) => <View key={label} style={styles.field}><Text style={theme.styles.muted}>{label}</Text><Text style={[styles.fieldValue, { color: theme.colors.ink }]}>{value}</Text></View>)}</View></View>; }
function PaymentInfo({ item }: { item: Item }) { const theme = useTheme(); const detail = paymentDetail(item); if (!detail) return null; const rows = [["Order reference", detail.orderReference ?? ""], ["Payment reference", detail.paymentReference ?? ""], ["Payment method", paymentMethod(detail.paymentMethod ?? "")], ["Total", detail.total !== undefined && detail.total !== null ? formatMoney(detail.total, detail.currency ?? "USD") : ""], ["Currency", detail.currency ?? ""], ["Paid at", detail.paidAt ? formatDateTime(detail.paidAt) : ""]].filter(([, value]) => value); return <View>{rows.map(([label, value]) => <View key={String(label)} style={styles.paymentRow}><Text style={theme.styles.muted}>{String(label)}</Text><Text style={[styles.fieldValue, { color: theme.colors.ink }]}>{String(value)}</Text></View>)}</View>; }
function Action({ title, icon, onPress, disabled }: { title: string; icon: any; onPress: () => void; disabled?: boolean }) { const theme = useTheme(); return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={styles.actionRow}><SymbolView name={icon} size={20} tintColor={theme.colors.primary} fallback={<Text>{title[0]}</Text>} /><Text style={[styles.actionText, { color: theme.colors.ink }]}>{title}</Text></Pressable>; }
function isRecord(value: unknown): value is Item { return typeof value === "object" && value !== null && !Array.isArray(value); } function record(value: unknown): Item { return isRecord(value) ? value : {}; } function text(item: Item, keys: string[], fallback = "") { for (const key of keys) { const value = item[key]; if (typeof value === "string" && value.trim()) return value.trim(); if (typeof value === "number") return String(value); } return fallback; } function numeric(item: Item, keys: string[]) { for (const key of keys) { const value = item[key]; if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value); } return 0; } function orderReference(item: Item) { return text(item, ["order_code", "order_number", "reference", "id"]); } function isPaid(order: Item) { return Boolean(order.paid_at) || text(order, ["status"]).toLowerCase() === "paid"; } function matchTitle(item: Item) { const match = record(item.match); const home = typeof match.home_team === "string" ? match.home_team : text(record(match.home_team), ["name"]); const away = typeof match.away_team === "string" ? match.away_team : text(record(match.away_team), ["name"]); return home && away ? `${home} vs ${away}` : ""; } function matchVenue(item: Item) { const match = record(item.match); const venue = match.stadium ?? match.venue ?? match.location; return typeof venue === "string" ? venue : text(record(venue), ["name", "title"]); } function teamData(value: unknown) { if (typeof value === "string" && value.trim()) return { name: value.trim(), short: value.trim().slice(0, 3).toUpperCase() }; const team = record(value); const name = text(team, ["name"], ""); if (!name) return null; return { name, short: text(team, ["short_name"], name.slice(0, 3).toUpperCase()), logo: text(team, ["logo"], "") || undefined }; } function paymentMethod(value: string) { const normalized = value.toLowerCase(); if (normalized === "blue") return "Blue Wallet"; if (normalized === "cash") return "Cash"; if (normalized) return "Card"; return ""; }
const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignSelf: "center"
  },
  pageTitle: {
    paddingTop: 18,
    paddingBottom: 8,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900"
  },
  list: {
    paddingTop: 8,
    paddingBottom: 30
  },
  order: {
    minHeight: 96,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14
  },
  countBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  countNumber: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "900"
  },
  countLabel: {
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  orderCopy: {
    flex: 1,
    gap: 3
  },
  orderTitle: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900"
  }, orderMeta: {
    fontSize: 13,
    fontWeight: "700"
  },
  chevron: {
    fontSize: 26
  },
  pressed: {
    opacity: .68
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.62)"
  },
  ticketSheet: {
    maxHeight: "96%",
    minHeight: "82%",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 10,
    paddingBottom: 18,
    gap: 10,
    overflow: "hidden"
  },
  dragHandle: {
    width: 52,
    height: 5,
    opacity: .45,
    borderRadius: 999,
    alignSelf: "center",
    marginBottom: 4
  },
  modalTop: {
    minHeight: 44,
    paddingHorizontal: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  modalHeading: {
    alignItems: "center",
    paddingHorizontal: 34,
    gap: 5,
    marginBottom: 6
  },
  position: {
    fontSize: 16,
    fontWeight: "900"
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "900",
    textAlign: "center"
  },
  modalVenue: {
    textAlign: "center"
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  modalLoading: {
    flex: 1
  },
  ticketPager: {
    alignItems: "center"
  },
  flipPress: {
    height: 410,
    position: "relative"
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
  backFace: { alignItems: "center" }, info: { gap: 12 }, teams: { fontSize: 21, lineHeight: 27, fontWeight: "900", marginBottom: 10, textAlign: "center" }, field: { minHeight: 30, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }, fieldValue: { fontSize: 14, fontWeight: "800", textAlign: "right" }, flipHint: { position: "absolute", bottom: 17, alignSelf: "center", fontSize: 12, fontWeight: "800" }, qr: { width: 250, height: 250, maxWidth: "90%" }, holder: { color: "#0F172A", fontSize: 17, fontWeight: "900", marginTop: 10 }, reference: { color: "#64748B", fontSize: 12, marginTop: 3 }, actions: { flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 2 }, actionButton: { flex: 1 }, actionBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.45)" }, actionSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, gap: 4 }, actionRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10 }, actionText: { fontSize: 16, fontWeight: "800" }, paymentSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 14 }, paymentRow: { minHeight: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }
});
const ticketStyles = StyleSheet.create({
  filterBar: { minHeight: 48, marginTop: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 14 },
  clearSearch: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  order: { borderWidth: 1, borderRadius: 12, padding: 15, gap: 13, marginBottom: 12 },
  orderHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  orderHeading: { flex: 1, gap: 3 },
  orderReference: { fontSize: 17, fontWeight: "900" },
  statusBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  orderMetrics: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 11, flexDirection: "row", justifyContent: "space-between" },
  metricValue: { fontSize: 16, fontWeight: "900" },
  metricEnd: { alignItems: "flex-end" },
  contains: { gap: 4 },
  containsLabel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: .7 },
  summaryText: { fontSize: 13, fontWeight: "700" },
  moreText: { fontSize: 12, fontWeight: "800" },
  matchIdentity: { minHeight: 100, flexDirection: "row", alignItems: "center", gap: 10 },
  matchIdentityCompact: { minHeight: 86 },
  team: { flex: 1, minWidth: 0, alignItems: "center", gap: 6 },
  teamLogo: { width: 52, height: 52, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  teamLogoCompact: { width: 46, height: 46 },
  teamLogoImage: { width: "82%", height: "82%" },
  teamInitial: { fontSize: 12, fontWeight: "900" },
  teamName: { minHeight: 30, fontSize: 11, lineHeight: 15, fontWeight: "800", textAlign: "center" },
  vsBlock: { flex: 1.4, minWidth: 0, alignItems: "center", gap: 5 },
  vsText: { fontSize: 10, fontWeight: "900" },
  matchTitle: { fontSize: 15, lineHeight: 19, fontWeight: "900", textAlign: "center" },
  // faceContent: { flex: 1, width: "100%" },
  // flexRegion: { flexGrow: 1, minHeight: 6 },
  backCenter: { width: "100%", alignItems: "center" },
  // flipHint: { minHeight: 36, alignSelf: "center", textAlignVertical: "center", fontSize: 12, fontWeight: "800" },
  ticketInfo: { width: "100%", gap: 12 },
  matchZone: { justifyContent: "center" },
  detailsZone: { justifyContent: "center", gap: 7 },
  inlineError: { borderRadius: 10, padding: 12 },
  actionSheetHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
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
