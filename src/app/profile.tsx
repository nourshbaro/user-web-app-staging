import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Button, Empty, Loading, Screen, colors, useResponsive, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/format";
import { profileService } from "@/services/auth";
import type { Order } from "@/types";

type PortalItem = Record<string, any>;
type DetailState = { type: "order" | "ticket"; title: string; item: PortalItem; pdfId?: string } | null;

export default function ProfileScreen() {
  const auth = useAuth();
  const responsive = useResponsive();
  const theme = useTheme();
  const profileColumns = responsive.width >= 760 ? 2 : 1;
  const profileGap = 14;
  const panelWidth: DimensionValue = profileColumns === 1 ? "100%" : (responsive.contentWidth - profileGap * (profileColumns - 1)) / profileColumns;
  const heroWidth: DimensionValue = "100%";
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<PortalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
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

  const logout = async () => {
    setDetail(null);
    setOrders([]);
    setTickets([]);
    await auth.logout();
    router.replace("/");
  };

  const openOrder = async (order: Order & PortalItem) => {
    const id = order.order_number ?? order.order_code ?? order.code ?? order.reference ?? order.id;
    if (!id) return;
    setDetailLoading(true);
    setError(null);
    try {
      const item = await profileService.order(id);
      setDetail({ type: "order", title: `Order ${displayValue(order, ["order_code", "order_number", "id"], `#${id}`)}`, item, pdfId: String(id) });
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
      const pdfId = displayValue(item, ["order_code", "order_number", "order_id"], displayValue(ticket, ["order_code", "order_number", "order_id"], ""));
      setDetail({ type: "ticket", title: `Ticket ${code}`, item, pdfId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load ticket details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const downloadPdf = async (orderId?: string) => {
    if (!orderId) {
      setError("Order number is required to download the PDF.");
      return;
    }

    if (Platform.OS !== "web") {
      setError("PDF download is available from the web app.");
      return;
    }

    setDownloadingPdf(true);
    setError(null);
    try {
      const response = await profileService.orderPdf(orderId);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `order-${orderId}.pdf`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!auth.isReady) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Profile" }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="Profile" subtitle="Orders and tickets" />
        <ScrollView style={local.scroll} contentContainerStyle={local.content} showsVerticalScrollIndicator={false}>

        {!auth.isAuthenticated ? (
          <View style={local.guestWrap}>
            <Empty title="Login required" detail="Login to see your orders, tickets, and saved account details." />
            <Button title="Login or register" onPress={() => router.push("/auth")} />
          </View>
        ) : (
          <>
            <View style={local.profileGrid}>
              <View style={[local.profilePanel, { width: heroWidth }]}>
                <View style={[local.heroCard, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
                  <View style={local.heroTop}>
                    <View style={local.identity}>
                      <View
                        style={[
                          local.avatar,
                          {
                            backgroundColor: theme.isDark ? "#F8FAFC" : theme.colors.ink,
                            borderColor: theme.isDark ? "rgba(255,255,255,0.14)" : theme.colors.line,
                          },
                        ]}
                      >
                        <Text style={[local.avatarText, { color: theme.isDark ? "#0F172A" : "#FFFFFF" }]}>
                          {initials(auth.user?.name ?? auth.user?.email)}
                        </Text>
                      </View>
                      <View style={local.identityText}>
                        <Text style={local.eyebrow}>My account</Text>
                        <Text style={[local.title, { color: theme.colors.ink }]} numberOfLines={1}>{auth.user?.name ?? "Supporter"}</Text>
                      </View>
                    </View>
                    <Pressable onPress={() => void logout()} style={({ pressed }) => [local.logoutButton, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }, pressed && local.pressed]}>
                      <Text style={[local.logoutText, { color: theme.colors.ink }]}>Logout</Text>
                    </Pressable>
                  </View>

                  <Text style={[local.email, { color: theme.colors.secondary }]} numberOfLines={1}>{auth.user?.email}</Text>

                  <View style={[local.statGrid, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
                    <View style={local.statBox}>
                      <Text style={[local.statValue, { color: theme.colors.ink }]}>{orders.length}</Text>
                      <Text style={[local.statLabel, { color: theme.colors.muted }]}>Orders</Text>
                    </View>
                    <View style={[local.statDivider, { backgroundColor: theme.colors.line }]} />
                    <View style={local.statBox}>
                      <Text style={[local.statValue, { color: theme.colors.ink }]}>{tickets.length}</Text>
                      <Text style={[local.statLabel, { color: theme.colors.muted }]}>Tickets</Text>
                    </View>
                  </View>
                </View>
              </View>

              {loading ? <View style={local.fullWidth}><View style={local.inlineLoader}><ActivityIndicator color={colors.primary} /></View></View> : null}
              {detailLoading ? <Text style={[local.loadingText, local.fullWidth]}>Loading details...</Text> : null}
              {error ? <View style={local.fullWidth}><Empty title="Profile error" detail={error} /></View> : null}

              <View style={[local.profilePanel, { width: panelWidth }]}>
                <View style={[local.sectionCard, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
                  <View style={local.sectionHeader}>
                    <Text style={[local.sectionTitle, { color: theme.colors.ink }]}>Orders</Text>
                    <View style={local.countPill}><Text style={local.countText}>{orders.length}</Text></View>
                  </View>
                  {orders.length ? orders.map((order) => (
                    <Pressable key={order.id} onPress={() => void openOrder(order as Order & PortalItem)} style={({ pressed }) => [local.listRow, { borderTopColor: theme.colors.line }, pressed && local.rowPressed]}>
                      <View style={local.rowMain}>
                        <View style={local.rowTitleLine}>
                          <Text style={[local.rowTitle, { color: theme.colors.ink }]}>Order {displayValue(order as PortalItem, ["order_code", "order_number", "id"], `#${order.id}`)}</Text>
                        </View>
                        <Text style={[local.rowMeta, { color: theme.colors.secondary }]}>{formatMoney(order.total, order.currency ?? "USD")}</Text>
                        <Text style={[local.rowSubMeta, { color: theme.colors.muted }]}>Paid {formatDateValue(displayValue(order as PortalItem, ["paid_at"], ""))}</Text>
                      </View>
                      <View style={local.rowSide}>
                        <View style={local.viewPill}><Text style={local.viewPillText}>View</Text></View>
                        <StatusPill status={order.status ?? "Pending"} />
                      </View>
                    </Pressable>
                  )) : <Text style={[local.emptyText, { borderTopColor: theme.colors.line, color: theme.colors.muted }]}>No orders yet.</Text>}
                </View>
              </View>

              <View style={[local.profilePanel, { width: panelWidth }]}>
                <View style={[local.sectionCard, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
                  <View style={local.sectionHeader}>
                    <Text style={[local.sectionTitle, { color: theme.colors.ink }]}>Tickets</Text>
                    <View style={local.countPill}><Text style={local.countText}>{tickets.length}</Text></View>
                  </View>
                  {tickets.length ? tickets.slice(0, 10).map((ticket, index) => (
                    <Pressable key={ticket.id ?? ticket.ticket_code ?? index} onPress={() => void openTicket(ticket)} style={({ pressed }) => [local.listRow, { borderTopColor: theme.colors.line }, pressed && local.rowPressed]}>
                      <View style={local.rowMain}>
                        <View style={local.rowTitleLine}>
                          <Text style={[local.rowTitle, { color: theme.colors.ink }]}>{displayValue(ticket, ["ticket_code", "code"], `Ticket ${index + 1}`)}</Text>
                        </View>
                        <Text style={[local.rowMeta, { color: theme.colors.secondary }]}>{ticket.match_title ?? ticket.match?.name ?? ticket.holder_name ?? "Match ticket"}</Text>
                        <Text style={[local.rowSubMeta, { color: theme.colors.muted }]}>{ticket.zone?.name ?? ticket.seat?.label ?? ticket.order_code ?? "Tap for details"}</Text>
                      </View>
                      <View style={local.rowSide}>
                        <View style={local.viewPill}><Text style={local.viewPillText}>View</Text></View>
                        <StatusPill status={ticket.status ?? "Active"} />
                      </View>
                    </Pressable>
                  )) : <Text style={[local.emptyText, { borderTopColor: theme.colors.line, color: theme.colors.muted }]}>No tickets yet.</Text>}
                </View>
              </View>
            </View>
          </>
        )}
        </ScrollView>
      </View>

      <DetailModal detail={detail} downloadingPdf={downloadingPdf} onClose={() => setDetail(null)} onDownloadPdf={downloadPdf} />
    </Screen>
  );
}

function DetailModal({
  detail,
  downloadingPdf,
  onClose,
  onDownloadPdf,
}: {
  detail: DetailState;
  downloadingPdf: boolean;
  onClose: () => void;
  onDownloadPdf: (orderId?: string) => void;
}) {
  const item = detail?.item;
  const normalized = detail?.type === "order" && isRecord(item?.order) ? item.order : item;
  const entries = normalized ? Object.entries(normalized).filter(([key, value]) => shouldShowDetailField(key, value)) : [];
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
            <View style={local.modalActions}>
              {detail?.type === "order" && detail.pdfId ? (
                <Pressable
                  onPress={() => onDownloadPdf(detail.pdfId)}
                  disabled={downloadingPdf}
                  style={({ pressed }) => [local.pdfButton, pressed && local.pressed, downloadingPdf && local.buttonDisabled]}
                >
                  <Text style={local.pdfText}>{downloadingPdf ? "Downloading" : "PDF"}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} style={({ pressed }) => [local.closeButton, pressed && local.pressed]}>
                <Text style={local.closeText}>Close</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={local.detailContent} showsVerticalScrollIndicator={false}>
            {detail?.type === "ticket" && typeof item?.qr_image === "string" ? <QrImage value={item.qr_image} /> : null}

            {entries.map(([key, value]) => (
              <DetailField key={key} fieldKey={key} label={labelize(key)} value={value} />
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

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <View style={[local.statusPill, tone === "success" && local.statusPillSuccess, tone === "warning" && local.statusPillWarning]}>
      <Text style={[local.statusText, tone === "success" && local.statusTextSuccess, tone === "warning" && local.statusTextWarning]}>
        {status}
      </Text>
    </View>
  );
}

function DetailField({ fieldKey, label, value }: { fieldKey: string; label: string; value: unknown }) {
  if (Array.isArray(value)) return null;
  if (label.toLowerCase() === "qr image" && typeof value === "string") return <QrImage value={value} />;
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
      <Text style={local.detailValue}>{formatDetailValue(value, fieldKey)}</Text>
    </View>
  );
}

function NestedCard({ item }: { item: PortalItem }) {
  const hasQr = typeof item.qr_image === "string";

  return (
    <View style={local.nestedCard}>
      {hasQr ? <QrImage value={item.qr_image} compact /> : null}
      {Object.entries(item).filter(([key, value]) => shouldShowDetailField(key, value)).slice(0, 8).map(([key, value]) => (
        <View key={key} style={local.nestedRow}>
          <Text style={local.nestedLabel}>{labelize(key)}</Text>
          <Text style={local.nestedValue}>{isRecord(value) || Array.isArray(value) ? summarizeValue(value) : formatDetailValue(value, key)}</Text>
        </View>
      ))}
    </View>
  );
}

function QrImage({ value, compact = false }: { value: string; compact?: boolean }) {
  if (!value.startsWith("data:image/")) {
    return (
      <View style={local.qrEmpty}>
        <Text style={local.qrEmptyText}>QR unavailable</Text>
      </View>
    );
  }

  return (
    <View style={[local.qrWrap, compact && local.qrWrapCompact]}>
      <Image source={{ uri: value }} style={[local.qrImage, compact && local.qrImageCompact]} resizeMode="contain" />
      {!compact ? <Text style={local.qrCaption}>Ticket QR code</Text> : null}
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

function formatDetailValue(value: unknown, key = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (key === "payment_method") return paymentMethodLabel(String(value));
  if (isDateKey(key)) return formatDateValue(String(value));
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function paymentMethodLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cybersource") return "Credit / Debit Card";
  if (normalized === "blue") return "Blue Wallet";
  return value;
}

function statusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["paid", "valid", "active", "confirmed", "complete", "completed", "success"].includes(normalized)) return "success";
  if (["pending", "processing", "reserved"].includes(normalized)) return "warning";
  return "danger";
}

function isDateKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized.endsWith("_at") || normalized.includes("date") || normalized.includes("time");
}

function shouldShowDetailField(key: string, value: unknown) {
  return !["qr_image", "created_at", "id", "order_number", "order_code", "ticket_code", "code"].includes(key) && value !== null && value !== undefined && value !== "";
}

function formatDateValue(value: string) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function summarizeValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (!isRecord(value)) return formatDetailValue(value);
  return displayValue(value, ["name", "label", "title", "code", "ticket_code", "order_code", "home_team"], "Details");
}

const local = StyleSheet.create({
  shell: {
    flex: 1,
    alignSelf: "center",
  },
  scroll: {
    width: "100%",
  },
  content: {
    alignSelf: "center",
    width: "100%",
    gap: 14,
    paddingBottom: 32,
    paddingTop: 4,
  },
  guestWrap: {
    gap: 12,
  },
  profileGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    alignItems: "flex-start",
  },
  profilePanel: {
    minWidth: 0,
  },
  fullWidth: {
    width: "100%",
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
    borderWidth: 1,
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
  rowSide: {
    width: 76,
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 8,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowTitle: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  viewPill: {
    borderRadius: 999,
    backgroundColor: "rgba(200,16,46,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 52,
    alignItems: "center",
  },
  viewPillText: {
    color: colors.primary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    textTransform: "uppercase",
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
    minWidth: 52,
    alignItems: "center",
  },
  statusPillSuccess: {
    backgroundColor: "rgba(0,122,61,0.11)",
  },
  statusPillWarning: {
    backgroundColor: "rgba(200,168,75,0.16)",
  },
  statusText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusTextSuccess: {
    color: colors.green,
  },
  statusTextWarning: {
    color: "#8A6A1D",
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
  modalActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pdfButton: {
    minHeight: 38,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
  },
  pdfText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.58,
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
  qrWrap: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    padding: 14,
    gap: 8,
  },
  qrWrapCompact: {
    alignSelf: "center",
    padding: 10,
    marginBottom: 4,
  },
  qrImage: {
    width: 190,
    height: 190,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  qrImageCompact: {
    width: 136,
    height: 136,
  },
  qrCaption: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  qrEmpty: {
    minHeight: 120,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  qrEmptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
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
