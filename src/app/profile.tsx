import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Empty, Loading, Screen, colors } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/format";
import { profileService } from "@/services/auth";
import type { Order } from "@/types";

type PortalItem = Record<string, any>;
type DetailState = { type: "order" | "ticket"; title: string; item: PortalItem } | null;

export default function ProfileScreen() {
  const auth = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<PortalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<DetailState>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!auth.isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const [nextOrders, nextTickets] = await Promise.all([profileService.orders(), profileService.tickets()]);
      setOrders(Array.isArray(nextOrders) ? nextOrders : []);
      setTickets(Array.isArray(nextTickets) ? nextTickets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load profile.");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => {
    void auth.refreshAuth().then(load);
  }, [auth.isAuthenticated]));

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const logout = async () => {
    setDetail(null);
    setOrders([]);
    setTickets([]);
    await auth.logout();
    router.dismissAll();
    router.replace("/");
  };

  const openOrder = async (order: Order & PortalItem) => {
    const id = order.order_number ?? order.order_code ?? order.code ?? order.reference ?? order.id;
    if (!id) return;
    setDetailLoading(true);
    setError(null);
    try {
      const item = await profileService.order(id);
      setDetail({ type: "order", title: `Order ${displayValue(order, ["order_code", "order_number", "id"], `#${id}`)}`, item });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load order details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const openTicket = async (ticket: PortalItem) => {
    const code = displayValue(ticket, ["ticket_code", "code", "reference"], "");
    if (!code) return;
    setDetailLoading(true);
    setError(null);
    try {
      const item = await profileService.ticket(code);
      setDetail({ type: "ticket", title: `Ticket ${code}`, item });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ticket details.");
    } finally {
      setDetailLoading(false);
    }
  };

  if (!auth.isReady) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Profile" }} />
      <ScrollView style={local.scroll} contentContainerStyle={local.content} showsVerticalScrollIndicator={false}>
        <View style={local.topBar}>
          <Pressable onPress={goBack} style={({ pressed }) => [local.backButton, pressed && local.pressed]}>
            <Text style={local.backIcon}>‹</Text>
            <Text style={local.backText}>Back</Text>
          </Pressable>
        </View>

        {!auth.isAuthenticated ? (
          <View style={local.guestWrap}>
            <Empty title="Login required" detail="Login to see your orders, tickets, and saved account details." />
            <Button title="Login or register" onPress={() => router.push("/auth")} />
          </View>
        ) : (
          <>
            <View style={local.heroCard}>
              <View style={local.heroTop}>
                <View style={local.identity}>
                  <View style={local.avatar}>
                    <Text style={local.avatarText}>{initials(auth.user?.name ?? auth.user?.email)}</Text>
                  </View>
                  <View style={local.identityText}>
                    <Text style={local.eyebrow}>My account</Text>
                    <Text style={local.title} numberOfLines={1}>{auth.user?.name ?? "Supporter"}</Text>
                  </View>
                </View>
                <Pressable onPress={() => void logout()} style={({ pressed }) => [local.logoutButton, pressed && local.pressed]}>
                  <Text style={local.logoutText}>Logout</Text>
                </Pressable>
              </View>

              <Text style={local.email} numberOfLines={1}>{auth.user?.email}</Text>

              <View style={local.statGrid}>
                <View style={local.statBox}>
                  <Text style={local.statValue}>{orders.length}</Text>
                  <Text style={local.statLabel}>Orders</Text>
                </View>
                <View style={local.statDivider} />
                <View style={local.statBox}>
                  <Text style={local.statValue}>{tickets.length}</Text>
                  <Text style={local.statLabel}>Tickets</Text>
                </View>
              </View>
            </View>

            {loading ? <View style={local.inlineLoader}><ActivityIndicator color={colors.primary} /></View> : null}
            {detailLoading ? <Text style={local.loadingText}>Loading details...</Text> : null}
            {error ? <Empty title="Profile error" detail={error} /> : null}

            <View style={local.sectionCard}>
              <View style={local.sectionHeader}>
                <Text style={local.sectionTitle}>Orders</Text>
                <View style={local.countPill}><Text style={local.countText}>{orders.length}</Text></View>
              </View>
              {orders.length ? orders.map((order) => (
                <Pressable key={order.id} onPress={() => void openOrder(order as Order & PortalItem)} style={({ pressed }) => [local.listRow, pressed && local.rowPressed]}>
                  <View style={local.rowMain}>
                    <View style={local.rowTitleLine}>
                      <Text style={local.rowTitle}>Order {displayValue(order as PortalItem, ["order_code", "order_number", "id"], `#${order.id}`)}</Text>
                      <Text style={local.chevron}>›</Text>
                    </View>
                    <Text style={local.rowMeta}>{formatMoney(order.total, order.currency ?? "USD")}</Text>
                    <Text style={local.rowSubMeta}>{displayValue(order as PortalItem, ["created_at", "date", "paid_at"], "Date unavailable")}</Text>
                  </View>
                  <View style={local.statusPill}>
                    <Text style={local.statusText}>{order.status ?? "Pending"}</Text>
                  </View>
                </Pressable>
              )) : <Text style={local.emptyText}>No orders yet.</Text>}
            </View>

            <View style={local.sectionCard}>
              <View style={local.sectionHeader}>
                <Text style={local.sectionTitle}>Tickets</Text>
                <View style={local.countPill}><Text style={local.countText}>{tickets.length}</Text></View>
              </View>
              {tickets.length ? tickets.slice(0, 10).map((ticket, index) => (
                <Pressable key={ticket.id ?? ticket.ticket_code ?? index} onPress={() => void openTicket(ticket)} style={({ pressed }) => [local.listRow, pressed && local.rowPressed]}>
                  <View style={local.rowMain}>
                    <View style={local.rowTitleLine}>
                      <Text style={local.rowTitle}>{displayValue(ticket, ["ticket_code", "code"], `Ticket ${index + 1}`)}</Text>
                      <Text style={local.chevron}>›</Text>
                    </View>
                    <Text style={local.rowMeta}>{ticket.match_title ?? ticket.match?.name ?? ticket.holder_name ?? "Match ticket"}</Text>
                    <Text style={local.rowSubMeta}>{ticket.zone?.name ?? ticket.seat?.label ?? ticket.order_code ?? "Tap for details"}</Text>
                  </View>
                  <View style={local.ticketPill}>
                    <Text style={local.ticketText}>{ticket.status ?? "Active"}</Text>
                  </View>
                </Pressable>
              )) : <Text style={local.emptyText}>No tickets yet.</Text>}
            </View>
          </>
        )}
      </ScrollView>

      <DetailModal detail={detail} onClose={() => setDetail(null)} />
    </Screen>
  );
}

function DetailModal({ detail, onClose }: { detail: DetailState; onClose: () => void }) {
  const item = detail?.item;
  const normalized = detail?.type === "order" && isRecord(item?.order) ? item.order : item;
  const entries = normalized ? Object.entries(normalized).filter(([, value]) => value !== null && value !== undefined && value !== "") : [];
  const items = Array.isArray(item?.items) ? item.items.filter(isRecord) : [];
  const tickets = Array.isArray(item?.tickets) ? item.tickets.filter(isRecord) : [];

  return (
    <Modal visible={Boolean(detail)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={local.modalOverlay}>
        <View style={local.modalSheet}>
          <View style={local.modalHeader}>
            <View style={local.modalTitleWrap}>
              <Text style={local.modalEyebrow}>{detail?.type === "order" ? "Order details" : "Ticket details"}</Text>
              <Text style={local.modalTitle} numberOfLines={2}>{detail?.title}</Text>
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => [local.closeButton, pressed && local.pressed]}>
              <Text style={local.closeText}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={local.detailContent} showsVerticalScrollIndicator={false}>
            {entries.map(([key, value]) => (
              <DetailField key={key} label={labelize(key)} value={value} />
            ))}

            {items.length ? (
              <View style={local.detailGroup}>
                <Text style={local.detailGroupTitle}>Items</Text>
                {items.map((entry, index) => <NestedCard key={index} item={entry} />)}
              </View>
            ) : null}

            {tickets.length ? (
              <View style={local.detailGroup}>
                <Text style={local.detailGroupTitle}>Tickets</Text>
                {tickets.map((entry, index) => <NestedCard key={index} item={entry} />)}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  if (Array.isArray(value)) return null;
  if (isRecord(value)) {
    return (
      <View style={local.detailGroup}>
        <Text style={local.detailGroupTitle}>{label}</Text>
        <NestedCard item={value} />
      </View>
    );
  }

  return (
    <View style={local.detailField}>
      <Text style={local.detailLabel}>{label}</Text>
      <Text style={local.detailValue}>{formatDetailValue(value)}</Text>
    </View>
  );
}

function NestedCard({ item }: { item: PortalItem }) {
  return (
    <View style={local.nestedCard}>
      {Object.entries(item).filter(([, value]) => value !== null && value !== undefined && value !== "").slice(0, 8).map(([key, value]) => (
        <View key={key} style={local.nestedRow}>
          <Text style={local.nestedLabel}>{labelize(key)}</Text>
          <Text style={local.nestedValue}>{isRecord(value) || Array.isArray(value) ? summarizeValue(value) : formatDetailValue(value)}</Text>
        </View>
      ))}
    </View>
  );
}

function initials(value?: string | null) {
  if (!value) return "LF";
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "LF";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function isRecord(value: unknown): value is PortalItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(item: PortalItem, keys: string[], fallback = "-") {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function summarizeValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (!isRecord(value)) return formatDetailValue(value);
  return displayValue(value, ["name", "label", "title", "code", "ticket_code", "order_code", "home_team"], "Details");
}

const local = StyleSheet.create({
  scroll: {
    width: "100%",
  },
  content: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 520,
    gap: 14,
    paddingBottom: 32,
    paddingTop: 4,
  },
  topBar: {
    alignItems: "flex-start",
  },
  backButton: {
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.82)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
  },
  backIcon: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 25,
    fontWeight: "800",
  },
  backText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  guestWrap: {
    gap: 12,
  },
  heroCard: {
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: "rgba(219,224,232,0.95)",
    padding: 18,
    gap: 16,
    shadowColor: colors.ink,
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  title: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "900",
    lineHeight: 31,
  },
  email: {
    color: colors.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
  logoutButton: {
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  logoutText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.78,
  },
  statGrid: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  statDivider: {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: colors.line,
  },
  statValue: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "900",
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  inlineLoader: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    fontWeight: "700",
  },
  sectionCard: {
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
    shadowColor: colors.ink,
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 4,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  countPill: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(200,16,46,0.08)",
  },
  countText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  listRow: {
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowPressed: {
    opacity: 0.72,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowTitle: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  chevron: {
    color: colors.primary,
    fontSize: 24,
    lineHeight: 24,
    fontWeight: "900",
  },
  rowMeta: {
    color: colors.secondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  rowSubMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(200,16,46,0.08)",
  },
  statusText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  ticketPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(0,122,61,0.09)",
  },
  ticketText: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  emptyText: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    paddingTop: 12,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(21,26,44,0.48)",
  },
  modalSheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.panel,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 14,
  },
  modalTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  modalEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 27,
  },
  closeButton: {
    minHeight: 38,
    borderRadius: 13,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  closeText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  detailContent: {
    gap: 10,
    paddingVertical: 14,
    paddingBottom: 28,
  },
  detailField: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    padding: 12,
    gap: 5,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailValue: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  detailGroup: {
    gap: 9,
  },
  detailGroupTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  nestedCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.95)",
    padding: 12,
    gap: 8,
  },
  nestedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  nestedLabel: {
    flex: 0.42,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  nestedValue: {
    flex: 0.58,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "right",
  },
});
