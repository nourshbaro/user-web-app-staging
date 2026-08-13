import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { MainHeader } from "@/components/MainHeader";
import {
  ProfileDetailModal,
  type ProfileDetailState,
} from "@/components/ProfileDetailModal";
import { Button, Empty, Input, Loading, Screen, useResponsive, useTheme, type ThemeColors } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { formatMoney } from "@/lib/format";
import {
  getTicketMatchName,
  getTicketOrderReference,
} from "@/lib/profilePortal";
import { ApiError } from "@/services/api";
import { authService, type OtpTarget } from "@/services/auth";
import { profileService } from "@/services/auth";
import {
  UserScopedCache,
  getUserScopedCacheGeneration,
  onUserScopedCacheInvalidated,
} from "@/lib/userScopedCache";
import { createAuthSubmissionGuard } from "@/lib/authSubmissionGuard";
import type { Order } from "@/types";

type PortalItem = Record<string, any>;
type DetailState = ProfileDetailState;
type GuestAuthMode = "login" | "register" | "otp";
type ProfileData = {
  orders: Order[];
  ordersTotal: number;
  tickets: PortalItem[];
  ticketsTotal: number;
};
const profileCache = new UserScopedCache<ProfileData>();

const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const getUserId = (payload: unknown): string | null => {
  if (!isRecord(payload)) return null;
  if (typeof payload.user_id === "number" || typeof payload.user_id === "string") return String(payload.user_id);
  if (isRecord(payload.user) && (typeof payload.user.id === "number" || typeof payload.user.id === "string")) return String(payload.user.id);
  if (isRecord(payload.data)) return getUserId(payload.data);
  return null;
};

const hasSessionToken = (payload: unknown): boolean => {
  if (!isRecord(payload)) return false;
  if (readString(payload.token) || readString(payload.access_token)) return true;
  return hasSessionToken(payload.data);
};

const getVerificationStatus = (payload: unknown): boolean | null => {
  if (!isRecord(payload)) return null;
  if (typeof payload.email_verified === "boolean") return payload.email_verified;
  if (typeof payload.verified === "boolean") return payload.verified;
  if (typeof payload.is_verified === "boolean") return payload.is_verified;
  if (typeof payload.email_verified_at === "string" && payload.email_verified_at.trim()) return true;
  if (payload.email_verified_at === null) return false;
  return getVerificationStatus(payload.user) ?? getVerificationStatus(payload.data);
};

const getMessage = (payload: unknown, fallback: string) => {
  if (!isRecord(payload)) return fallback;
  return readString(payload.message) ?? readString(payload.error) ?? fallback;
};

export default function ProfileScreen() {
  const local = useProfileStyles();
  const auth = useAuth();
  const toast = useToast();
  const responsive = useResponsive();
  const theme = useTheme();
  const isWide = responsive.width >= 760;
  const panelWidth: DimensionValue = isWide ? (responsive.contentWidth - 14) / 2 : "100%";
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [tickets, setTickets] = useState<PortalItem[]>([]);
  const [ticketsTotal, setTicketsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [detail, setDetail] = useState<DetailState>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeList, setActiveList] = useState<"orders" | "tickets">("orders");
  const [renderedOwnerKey, setRenderedOwnerKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const activeOwnerKey = auth.isAuthenticated ? auth.userCacheKey : null;
  const refreshAuth = auth.refreshAuth;
  const visibleOrders = renderedOwnerKey === activeOwnerKey ? orders : [];
  const visibleTickets = renderedOwnerKey === activeOwnerKey ? tickets : [];
  const visibleOrdersTotal = renderedOwnerKey === activeOwnerKey ? ordersTotal : 0;
  const visibleTicketsTotal = renderedOwnerKey === activeOwnerKey ? ticketsTotal : 0;

  useEffect(() => onUserScopedCacheInvalidated(() => {
    requestIdRef.current += 1;
    setOrders([]);
    setOrdersTotal(0);
    setTickets([]);
    setTicketsTotal(0);
    setRenderedOwnerKey(null);
    setDetail(null);
    setError(null);
    setLoading(false);
    setRefreshing(false);
    setDetailLoading(false);
    setDownloadingPdf(false);
  }), []);

  const load = useCallback(async (force = false) => {
    const ownerKey = activeOwnerKey;
    if (!ownerKey) return;

    const requestId = ++requestIdRef.current;
    const cacheGeneration = getUserScopedCacheGeneration();
    const cached = force ? null : profileCache.get(ownerKey);
    if (cached) {
      setOrders(cached.orders);
      setOrdersTotal(cached.ordersTotal);
      setTickets(cached.tickets);
      setTicketsTotal(cached.ticketsTotal);
      setRenderedOwnerKey(ownerKey);
      return;
    }

    setOrders([]);
    setOrdersTotal(0);
    setTickets([]);
    setTicketsTotal(0);
    setRenderedOwnerKey(null);
    setLoading(true);
    setError(null);
    try {
      const [nextOrders, nextTickets] = await Promise.all([profileService.orders(), profileService.tickets()]);
      if (
        requestId !== requestIdRef.current
        || cacheGeneration !== getUserScopedCacheGeneration()
      ) return;

      const nextData: ProfileData = {
        orders: nextOrders.items,
        ordersTotal: nextOrders.total,
        tickets: nextTickets.items,
        ticketsTotal: nextTickets.total,
      };
      profileCache.set(ownerKey, nextData);
      setOrders(nextData.orders);
      setOrdersTotal(nextData.ordersTotal);
      setTickets(nextData.tickets);
      setTicketsTotal(nextData.ticketsTotal);
      setRenderedOwnerKey(ownerKey);
    } catch (err) {
      if (
        requestId !== requestIdRef.current
        || cacheGeneration !== getUserScopedCacheGeneration()
      ) return;
      setError(err instanceof Error ? err.message : "Could not load profile.");
    } finally {
      if (
        requestId === requestIdRef.current
        && cacheGeneration === getUserScopedCacheGeneration()
      ) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeOwnerKey]);

  useFocusEffect(useCallback(() => {
    void refreshAuth();
    if (activeOwnerKey) void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [activeOwnerKey, load, refreshAuth]));

  const logout = async () => {
    await auth.logout();
    router.replace("/");
  };

  const openOrder = async (order: Order & PortalItem) => {
    const id = order.order_number ?? order.order_code ?? order.code ?? order.reference ?? order.id;
    if (!id || !activeOwnerKey) return;
    const cacheGeneration = getUserScopedCacheGeneration();
    setDetailLoading(true);
    setError(null);
    try {
      const item = await profileService.order(id);
      if (cacheGeneration !== getUserScopedCacheGeneration()) return;
      setDetail({ type: "order", title: `Order ${displayValue(order, ["order_code", "order_number", "id"], `#${id}`)}`, item, pdfId: String(id) });
    } catch (err) {
      if (cacheGeneration !== getUserScopedCacheGeneration()) return;
      setError(err instanceof Error ? err.message : "Could not load order details.");
    } finally {
      if (cacheGeneration === getUserScopedCacheGeneration()) {
        setDetailLoading(false);
      }
    }
  };

  const openTicket = async (ticket: PortalItem) => {
    const code = displayValue(ticket, ["ticket_code", "code", "reference"], "");
    if (!code || !activeOwnerKey) return;
    const cacheGeneration = getUserScopedCacheGeneration();
    setDetailLoading(true);
    setError(null);
    try {
      const item = await profileService.ticket(code);
      if (cacheGeneration !== getUserScopedCacheGeneration()) return;
      const pdfId = displayValue(item, ["order_code", "order_number", "order_id"], displayValue(ticket, ["order_code", "order_number", "order_id"], ""));
      setDetail({ type: "ticket", title: `Ticket ${code}`, item, pdfId });
    } catch (err) {
      if (cacheGeneration !== getUserScopedCacheGeneration()) return;
      setError(err instanceof Error ? err.message : "Could not load ticket details.");
    } finally {
      if (cacheGeneration === getUserScopedCacheGeneration()) {
        setDetailLoading(false);
      }
    }
  };

  const downloadPdf = async (orderId?: string) => {
    if (!orderId || !activeOwnerKey) {
      setError("Order number is required to download the PDF.");
      return;
    }

    const cacheGeneration = getUserScopedCacheGeneration();
    setDownloadingPdf(true);
    setError(null);
    try {
      const pdfBytes = await profileService.orderPdf(orderId);
      if (cacheGeneration !== getUserScopedCacheGeneration()) return;
      if (Platform.OS !== "web") {
        const FileSystem = await import("expo-file-system");
        const Sharing = await import("expo-sharing");
        // SDK 56 exposes these native methods at runtime, while its generated File type omits inherited members.
        const file = new FileSystem.File(FileSystem.Paths.cache, `order-${orderId}.pdf`) as unknown as {
          create: (options?: { overwrite?: boolean }) => void;
          write: (content: Uint8Array) => void;
          uri: string;
        };
        file.create({ overwrite: true });
        file.write(new Uint8Array(pdfBytes));
        if (cacheGeneration !== getUserScopedCacheGeneration()) return;
        if (!(await Sharing.isAvailableAsync())) throw new Error("No app is available to open this PDF.");
        await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: `Order ${orderId}` });
        return;
      }
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      if (cacheGeneration !== getUserScopedCacheGeneration()) return;
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `order-${orderId}.pdf`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      if (cacheGeneration !== getUserScopedCacheGeneration()) return;
      setError(err instanceof Error ? err.message : "Failed to download PDF.");
    } finally {
      if (cacheGeneration === getUserScopedCacheGeneration()) {
        setDownloadingPdf(false);
      }
    }
  };

  if (!auth.isReady) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Profile" }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <MainHeader />
        <ScrollView
          style={local.scroll}
          contentContainerStyle={local.content}
          showsVerticalScrollIndicator={false}
          refreshControl={auth.isAuthenticated ? <RefreshControl refreshing={refreshing} tintColor={theme.colors.primary} onRefresh={() => { setRefreshing(true); void load(true); }} /> : undefined}
        >

          {!auth.isAuthenticated ? (
            <View style={local.guestWrap}>
              <GuestAuthForm onSignedIn={() => { toast.showToast({ variant: "success", title: "Signed in", message: "Welcome back." }); }} />
            </View>
          ) : (
            <>
              <View style={local.profileGrid}>
                <View style={[local.profilePanel, { width: "100%" }]}>
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
                      <Pressable onPress={() => setActiveList("orders")} style={[local.statBox, !isWide && activeList === "orders" && { backgroundColor: theme.isDark ? "rgba(232,17,45,0.14)" : "rgba(200,16,46,0.06)" }]}>
                        <Text style={[local.statValue, { color: theme.colors.ink }]}>{visibleOrdersTotal}</Text>
                        <Text style={[local.statLabel, { color: !isWide && activeList === "orders" ? theme.colors.primary : theme.colors.muted }]}>Orders</Text>
                      </Pressable>
                      <View style={[local.statDivider, { backgroundColor: theme.colors.line }]} />
                      <Pressable onPress={() => setActiveList("tickets")} style={[local.statBox, !isWide && activeList === "tickets" && { backgroundColor: theme.isDark ? "rgba(232,17,45,0.14)" : "rgba(200,16,46,0.06)" }]}>
                        <Text style={[local.statValue, { color: theme.colors.ink }]}>{visibleTicketsTotal}</Text>
                        <Text style={[local.statLabel, { color: !isWide && activeList === "tickets" ? theme.colors.primary : theme.colors.muted }]}>Tickets</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>

                {loading ? <View style={local.fullWidth}><View style={local.inlineLoader}><ActivityIndicator color={theme.colors.primary} /></View></View> : null}
                {detailLoading ? <Text style={[local.loadingText, local.fullWidth]}>Loading details...</Text> : null}
                {error ? <View style={local.fullWidth}><Empty title="Profile error" detail={error} /></View> : null}

                {isWide || activeList === "orders" ? (
                  <View style={[local.profilePanel, { width: panelWidth }]}>
                    <View style={[local.sectionCard, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
                      <View style={local.sectionHeader}>
                        <Text style={[local.sectionTitle, { color: theme.colors.ink }]}>Orders</Text>
                        <View style={local.countPill}><Text style={local.countText}>{visibleOrdersTotal}</Text></View>
                      </View>
                      {visibleOrders.length ? visibleOrders.map((order) => (
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
                ) : null}

                {isWide || activeList === "tickets" ? (
                  <View style={[local.profilePanel, { width: panelWidth }]}>
                    <View style={[local.sectionCard, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
                      <View style={local.sectionHeader}>
                        <Text style={[local.sectionTitle, { color: theme.colors.ink }]}>Tickets</Text>
                        <View style={local.countPill}><Text style={local.countText}>{visibleTicketsTotal}</Text></View>
                      </View>
                      {visibleTickets.length ? visibleTickets.slice(0, 10).map((ticket, index) => {
                        const ticketMatchName = getTicketMatchName(ticket);
                        const ticketOrderReference = getTicketOrderReference(ticket);

                        return (
                          <Pressable key={ticket.id ?? ticket.ticket_code ?? index} onPress={() => void openTicket(ticket)} style={({ pressed }) => [local.listRow, { borderTopColor: theme.colors.line }, pressed && local.rowPressed]}>
                            <View style={local.rowMain}>
                              <View style={local.rowTitleLine}>
                                <Text style={[local.rowTitle, { color: theme.colors.ink }]}>{displayValue(ticket, ["ticket_code", "code"], `Ticket ${index + 1}`)}</Text>
                              </View>
                              <Text style={[local.rowMeta, { color: theme.colors.secondary }]}>Match: {ticketMatchName ?? "Unavailable"}</Text>
                              <Text style={[local.rowSubMeta, { color: theme.colors.muted }]}>Order: {ticketOrderReference ?? "Unavailable"}</Text>
                            </View>
                            <View style={local.rowSide}>
                              <View style={local.viewPill}><Text style={local.viewPillText}>View</Text></View>
                              <StatusPill status={ticket.status ?? "Active"} />
                            </View>
                          </Pressable>
                        );
                      }) : <Text style={[local.emptyText, { borderTopColor: theme.colors.line, color: theme.colors.muted }]}>No tickets yet.</Text>}
                    </View>
                  </View>
                ) : null}
              </View>
            </>
          )}
          <InfoSections />
        </ScrollView>
      </View>

      <ProfileDetailModal
        detail={detail}
        downloadingPdf={downloadingPdf}
        onClose={() => setDetail(null)}
        onDownloadPdf={downloadPdf}
      />
    </Screen>
  );
}

function GuestAuthForm({ onSignedIn }: { onSignedIn: () => void }) {
  const local = useProfileStyles();
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const [mode, setMode] = useState<GuestAuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [pendingOtpTarget, setPendingOtpTarget] = useState<OtpTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const submissionGuard = useRef(createAuthSubmissionGuard());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showOtp = (payload: unknown, fallback: string, fallbackEmail = email.trim()) => {
    const userId = getUserId(payload);
    const nextMessage = getMessage(payload, fallback);
    setPendingOtpTarget({ userId, email: fallbackEmail || null });
    setOtp("");
    setMode("otp");
    setMessage(nextMessage);
    toast.showToast({ variant: "info", title: "OTP required", message: nextMessage });
  };

  const submit = async () => {
    if (!submissionGuard.current.tryAcquire()) return;
    setLoading(true);
    setMessage(null);
    try {
      if (mode === "otp") {
        if (!pendingOtpTarget || otp.length !== 6) {
          const nextMessage = "Enter the 6-digit OTP sent to your email.";
          setMessage(nextMessage);
          toast.showToast({ variant: "warning", title: "OTP incomplete", message: nextMessage });
          return;
        }
        await authService.verifyOtp(pendingOtpTarget, otp);
        if (!mountedRef.current) return;
        await auth.refreshAuth();
        if (!mountedRef.current) return;
        onSignedIn();
        return;
      }

      if (mode === "register") {
        if (password !== passwordConfirmation) {
          setMessage("Password confirmation does not match.");
          return;
        }
        const payload = await authService.register(name.trim(), email.trim(), password, passwordConfirmation);
        if (!mountedRef.current) return;
        showOtp(payload, "Account created. Enter the 6-digit OTP sent to your email.");
        return;
      }

      const trimmedEmail = email.trim();
      const verification = await authService.checkEmailVerification(trimmedEmail);
      if (!mountedRef.current) return;
      if (verification && getVerificationStatus(verification) === false) {
        showOtp(verification, "Please verify your email. A new code has been sent.", trimmedEmail);
        return;
      }

      const payload = await authService.login(trimmedEmail, password);
      if (!mountedRef.current) return;
      const userId = getUserId(payload);
      if (userId && !hasSessionToken(payload)) {
        showOtp(payload, "Please verify your email. A new code has been sent.", trimmedEmail);
        return;
      }
      await auth.refreshAuth();
      if (!mountedRef.current) return;
      onSignedIn();
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && mode === "login" && getUserId(err.body)) {
        showOtp(err.body, "Please verify your email. A new code has been sent.", email.trim());
        return;
      }
      const nextMessage = err instanceof ApiError || err instanceof Error ? err.message : "Please try again.";
      setMessage(nextMessage);
      toast.showToast({ variant: "error", title: "Unable to continue", message: nextMessage });
    } finally {
      submissionGuard.current.release();
      if (mountedRef.current) setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!pendingOtpTarget) return;
    setResending(true);
    setMessage(null);
    try {
      const payload = await authService.resendOtp(pendingOtpTarget);
      const nextMessage = getMessage(payload, "A new OTP was sent to your email.");
      setMessage(nextMessage);
      toast.showToast({ variant: "success", title: "OTP sent", message: nextMessage });
    } catch (err) {
      const nextMessage = err instanceof Error ? err.message : "Unable to resend OTP.";
      setMessage(nextMessage);
      toast.showToast({ variant: "error", title: "Could not resend OTP", message: nextMessage });
    } finally {
      setResending(false);
    }
  };

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setMessage(null);
    setOtp("");
    setPendingOtpTarget(null);
  };

  return (
    <View style={[local.authPanel, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
      {mode !== "otp" ? (
        <View style={[local.authTabs, { backgroundColor: theme.colors.panelSoft }]}>
          <Pressable onPress={() => switchMode("login")} style={[local.authTab, mode === "login" && { backgroundColor: theme.colors.primary }]}>
            <Text style={[local.authTabText, { color: mode === "login" ? "#FFFFFF" : theme.colors.secondary }]}>Login</Text>
          </Pressable>
          <Pressable onPress={() => switchMode("register")} style={[local.authTab, mode === "register" && { backgroundColor: theme.colors.primary }]}>
            <Text style={[local.authTabText, { color: mode === "register" ? "#FFFFFF" : theme.colors.secondary }]}>Register</Text>
          </Pressable>
        </View>
      ) : null}
      {mode === "register" ? <Input label="Full name" value={name} onChangeText={setName} autoCapitalize="words" /> : null}
      {mode === "otp" ? (
        <Input
          label="6-digit OTP"
          value={otp}
          onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          style={local.otpInput}
        />
      ) : (
        <>
          <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {mode === "register" ? <Input label="Confirm password" value={passwordConfirmation} onChangeText={setPasswordConfirmation} secureTextEntry /> : null}
        </>
      )}
      {message ? <Text style={[local.message, { color: theme.colors.secondary }]}>{message}</Text> : null}
      <Button
        title={loading ? "Please wait..." : mode === "login" ? "Login" : mode === "register" ? "Register" : "Confirm email"}
        disabled={
          loading ||
          (mode === "login" && (!email || !password)) ||
          (mode === "register" && (!name || !email || !password || !passwordConfirmation)) ||
          (mode === "otp" && (!pendingOtpTarget || otp.length !== 6))
        }
        onPress={submit}
      />
      {mode === "otp" ? (
        <>
          <Button title={resending ? "Sending..." : "Resend OTP"} variant="secondary" disabled={resending || !pendingOtpTarget} onPress={resendOtp} />
          <Text style={[local.footerText, { color: theme.colors.secondary }]}>
            Already confirmed? <Text style={local.footerLink} onPress={() => switchMode("login")}>Login</Text>
          </Text>
        </>
      ) : null}
    </View>
  );
}

function InfoSections() {
  const local = useProfileStyles();
  const theme = useTheme();

  return (
    <View style={local.infoSections}>
      {["Privacy", "Terms of Use", "FAQ"].map((title) => (
        <View key={title} style={[local.infoRow, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
          <Text style={[local.infoTitle, { color: theme.colors.ink }]}>{title}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const local = useProfileStyles();
  const tone = statusTone(status);
  return (
    <View style={[local.statusPill, tone === "success" && local.statusPillSuccess, tone === "warning" && local.statusPillWarning]}>
      <Text style={[local.statusText, tone === "success" && local.statusTextSuccess, tone === "warning" && local.statusTextWarning]}>
        {status}
      </Text>
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

function statusTone(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["paid", "valid", "active", "confirmed", "complete", "completed", "success"].includes(normalized)) return "success";
  if (["pending", "processing", "reserved"].includes(normalized)) return "warning";
  return "danger";
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

function useProfileStyles() {
  const theme = useTheme();
  return useMemo(() => createProfileStyles(theme.colors), [theme.colors]);
}

function createProfileStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    authPanel: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      padding: 16,
      gap: 12,
    },
    authTabs: {
      flexDirection: "row",
      borderRadius: 8,
      backgroundColor: colors.panelSoft,
      padding: 4,
      gap: 4,
    },
    authTab: {
      flex: 1,
      minHeight: 38,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
    },
    authTabActive: {
      backgroundColor: colors.primary,
    },
    authTabText: {
      color: colors.secondary,
      fontSize: 13,
      fontWeight: "900",
    },
    authTabTextActive: {
      color: "#FFFFFF",
    },
    message: {
      color: colors.secondary,
      fontSize: 13,
      lineHeight: 19,
    },
    otpInput: {
      textAlign: "center",
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 8,
    },
    footerText: {
      color: colors.secondary,
      textAlign: "center",
      fontSize: 14,
    },
    footerLink: {
      color: colors.primary,
      fontWeight: "900",
    },
    infoSections: {
      gap: 8,
    },
    infoRow: {
      minHeight: 52,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      justifyContent: "center",
      paddingHorizontal: 14,
    },
    infoTitle: {
      color: colors.ink,
      fontSize: 15,
      fontWeight: "900",
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
      overflow: "hidden",
    },
    statBox: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      alignSelf: "stretch",
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
  });
}
