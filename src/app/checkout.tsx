import { AppHeader } from "@/components/AppHeader";
import { CybersourceUnifiedCheckout } from "@/components/CybersourceUnifiedCheckout";
import { Button, Card, Empty, Input, Screen, useResponsive, useTheme, type ThemeColors } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { clearBluePaymentHandoff, createBluePaymentHandoff } from "@/lib/bluePaymentHandoff";
import { validateBluePaymentUrl } from "@/lib/bluePaymentRedirect";
import { groupCartItems } from "@/lib/cartDisplay";
import { checkoutResultRouteParams, parseCheckoutResultParams } from "@/lib/checkoutResultParams";
import { config } from "@/lib/config";
import { formatMoney, minutesSeconds } from "@/lib/format";
import { profileService } from "@/services/auth";
import { checkoutService } from "@/services/checkout";
import type { CheckoutSubmitRequest } from "@/types";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";

type PaymentMethod = CheckoutSubmitRequest["payment_method"];
type BillingInfoPayload = Record<string, unknown>;

const paymentOptions: Array<{ id: PaymentMethod; title: string; detail: string }> = [
  { id: "blue", title: "Blue Wallet", detail: "Redirect to Blue to complete payment." },
  { id: "cybersource", title: "Credit / Debit Card", detail: "Visa and Mastercard secure checkout." },
];
const LEBANON_DIAL_CODE = "+961";
const LEBANON_COUNTRY_DIGITS = "961";
const CHECKOUT_COUNTRY_CODE = "LB";
const CHECKOUT_COUNTRY_LABEL = "Lebanon";

function getCheckoutOrigin() {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return config.siteUrl;
}

function readCaptureContext(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { capture_context?: unknown; data?: { capture_context?: unknown } };
  const value = record.data?.capture_context ?? record.capture_context;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatLebanonPhone(value: string) {
  const digitsOnly = value.replace(/\D/g, "");
  if (!digitsOnly || LEBANON_COUNTRY_DIGITS.startsWith(digitsOnly)) return LEBANON_DIAL_CODE;

  const localDigits = (digitsOnly.startsWith("961") ? digitsOnly.slice(3) : digitsOnly).slice(0, 8);
  const part1 = localDigits.slice(0, 2);
  const part2 = localDigits.slice(2, 5);
  const part3 = localDigits.slice(5, 8);

  return `${LEBANON_DIAL_CODE}${part1 ? ` ${part1}` : ""}${part2 ? ` ${part2}` : ""}${part3 ? ` ${part3}` : ""}`;
}

function isCompleteLebanonPhone(value: string) {
  return /^\+961\s\d{2}\s\d{3}\s\d{3}$/.test(value);
}

function isRecord(value: unknown): value is BillingInfoPayload {
  return typeof value === "object" && value !== null;
}

function billingString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function billingField(data: unknown, keys: string[]) {
  if (!isRecord(data)) return "";
  for (const key of keys) {
    const value = billingString(data[key]);
    if (value) return value;
  }
  return "";
}

function unwrapBillingInfo(payload: unknown): BillingInfoPayload | null {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.data)) return payload.data;
  if (isRecord(payload.billing)) return payload.billing;
  if (isRecord(payload.billing_info)) return payload.billing_info;
  return payload;
}

function readBillingInfo(payload: unknown) {
  const data = unwrapBillingInfo(payload);

  return {
    name: billingField(data, ["name", "full_name"]),
    email: billingField(data, ["email"]),
    phone: billingField(data, ["phone", "phone_number", "mobile", "mobile_number", "telephone", "billing_phone", "billing_phone_number"]),
  };
}

export default function CheckoutScreen() {
  const cart = useCart();
  const auth = useAuth();
  const responsive = useResponsive();
  const theme = useTheme();
  const local = useMemo(() => createCheckoutStyles(theme.colors), [theme.colors]);
  const toast = useToast();
  const [name, setName] = useState(auth.user?.name ?? "");
  const [email, setEmail] = useState(auth.user?.email ?? "");
  const [phone, setPhone] = useState(LEBANON_DIAL_CODE);
  const [holderNames, setHolderNames] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("blue");
  const [captureContext, setCaptureContext] = useState<string | null>(null);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [billingInfoLoading, setBillingInfoLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const captureCalledRef = useRef(false);
  const captureSessionRef = useRef<string | null>(null);
  const submitInFlightRef = useRef(false);
  const blueHandoffStartedRef = useRef(false);
  const groupedItems = groupCartItems(cart.items);
  const isCheckoutLocked = loading;
  // Native tablets can rotate without inheriting the web-only sticky two-column layout.
  const isWide = Platform.OS === "web" && responsive.width >= 920;

  const ticketSlots = useMemo(
    () => cart.items.flatMap((item) => {
      const matchId = String(item.match_id);
      if (item.seats?.length) {
        return item.seats.map((seat) => ({
          key: `${item.lock_key}_seat_${seat.id}`,
          matchId,
          label: `${item.zone_name ?? "Zone"} - Seat ${seat.label ?? `${seat.row}${seat.number}`}`,
        }));
      }
      return Array.from({ length: Number(item.quantity ?? 1) }, (_, index) => ({
        key: `${item.lock_key}_ticket_${index}`,
        matchId,
        label: `${item.zone_name ?? "Zone"} - Ticket ${index + 1}`,
      }));
    }),
    [cart.items],
  );

  const loadCaptureContext = useCallback(async (sessionId: string, force = false) => {
    if (!force && captureCalledRef.current && captureSessionRef.current === sessionId) return;
    captureCalledRef.current = true;
    captureSessionRef.current = sessionId;

    setCaptureLoading(true);
    setCaptureError(null);
    try {
      const response = await checkoutService.captureContext(sessionId, [getCheckoutOrigin()]);
      const context = readCaptureContext(response);
      if (!context) throw new Error("Empty Cybersource capture context.");
      setCaptureContext(context);
    } catch (err) {
      captureCalledRef.current = false;
      setCaptureError(err instanceof Error ? err.message : "Could not prepare card payment.");
    } finally {
      setCaptureLoading(false);
    }
  }, []);

  useEffect(() => {
    const sessionId = cart.sessionId;
    if (!sessionId) {
      captureCalledRef.current = false;
      captureSessionRef.current = null;
      setCaptureContext(null);
      setCaptureError(null);
      return;
    }

    void loadCaptureContext(sessionId);
  }, [cart.sessionId, loadCaptureContext]);

  useEffect(() => {
    if (!auth.isReady || !auth.isAuthenticated) return;

    let cancelled = false;
    setBillingInfoLoading(true);

    profileService.billingInfo()
      .then((payload) => {
        if (cancelled) return;
        const nextBillingInfo = readBillingInfo(payload);

        if (nextBillingInfo.name) setName(nextBillingInfo.name);
        else if (auth.user?.name) setName(auth.user.name);
        if (nextBillingInfo.email) setEmail(nextBillingInfo.email);
        else if (auth.user?.email) setEmail(auth.user.email);
        if (nextBillingInfo.phone) setPhone(formatLebanonPhone(nextBillingInfo.phone));
      })
      .catch(() => {
        if (auth.user?.name) setName(auth.user.name);
        if (auth.user?.email) setEmail(auth.user.email);
      })
      .finally(() => {
        if (!cancelled) setBillingInfoLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.isAuthenticated, auth.isReady, auth.user?.email, auth.user?.name]);

  const dismissAllRoutes = () => {
    const resetRouter = router as typeof router & { dismissAll?: () => void };
    resetRouter.dismissAll?.();
  };

  const completeCheckout = async (resultParams: ReturnType<typeof checkoutResultRouteParams>) => {
    await cart.clearCart();
    dismissAllRoutes();
    router.replace({ pathname: "/checkout/success", params: resultParams });
  };

  useEffect(() => {
    return () => {
      captureCalledRef.current = false;
    };
  }, []);

  const submit = async (transientToken?: string) => {
    if (!cart.sessionId || submitInFlightRef.current || blueHandoffStartedRef.current) return;

    const missingHolder = ticketSlots.find((slot) => !holderNames[slot.key]?.trim());
    if (missingHolder) {
      toast.showToast({
        variant: "warning",
        title: "Ticket holder required",
        message: `Enter the holder name for ${missingHolder.label}.`,
      });
      return;
    }

    if (paymentMethod === "cybersource" && !transientToken) {
      toast.showToast({
        variant: "warning",
        title: "Card confirmation required",
        message: captureContext
          ? "Use the secure card checkout button to enter your card details."
          : captureError ?? "Card payment is still preparing. Try Blue Wallet or wait a moment.",
        duration: 5200,
      });
      return;
    }

    try {
      submitInFlightRef.current = true;
      setLoading(true);

      const ticketsByMatch = ticketSlots.reduce<Record<string, { holder_name: string }[]>>((acc, slot) => {
        acc[slot.matchId] = [...(acc[slot.matchId] ?? []), { holder_name: holderNames[slot.key].trim() }];
        return acc;
      }, {});

      const response = await checkoutService.submit({
        checkout_session_id: cart.sessionId,
        billing: { name, email, phone, country: CHECKOUT_COUNTRY_CODE },
        tickets_by_match: ticketsByMatch,
        payment_method: paymentMethod,
        ...(transientToken ? { payment: { transient_token: transientToken } } : {}),
      });

      if (paymentMethod === "blue") {
        const validatedUrl = validateBluePaymentUrl(response.payment?.payment_url, config.bluePaymentAllowedOrigin);
        blueHandoffStartedRef.current = true;

        if (Platform.OS === "web") {
          try {
            await cart.clearCart();
            if (typeof window === "undefined") throw new Error("Blue payment navigation is unavailable.");
            window.location.assign(validatedUrl);
          } catch (error) {
            blueHandoffStartedRef.current = false;
            throw error;
          }
          return;
        }

        const handoffId = createBluePaymentHandoff(validatedUrl);
        try {
          await cart.clearCart();
          dismissAllRoutes();
          router.replace({ pathname: "/checkout/blue/payment", params: { handoff: handoffId } });
        } catch (error) {
          clearBluePaymentHandoff(handoffId);
          blueHandoffStartedRef.current = false;
          throw error;
        }
        return;
      }

      const resultParams = checkoutResultRouteParams(parseCheckoutResultParams({
        provider: "cybersource",
        order_id: response.order_id,
        order_number: response.order_number,
        reference:
          response.reference
          ?? response.payment_reference
          ?? response.payment?.reference
          ?? response.payment?.payment_reference,
        status: response.status ?? response.payment?.status,
      }));
      await completeCheckout(resultParams);
    } catch (err) {
      toast.showToast({
        variant: "error",
        title: "Checkout failed",
        message: err instanceof Error ? err.message : "Please try again.",
        duration: 6200,
      });
    } finally {
      submitInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleCardSuccess = (transientToken: string) => {
    void submit(transientToken);
  };

  const handleCardError = (message: string) => {
    toast.showToast({
      variant: "warning",
      title: "Payment was not completed",
      message,
      duration: 5200,
    });
  };

  const renderOrderSummary = () => (
    <Card>
      <View style={theme.styles.row}>
        <Text style={theme.styles.h2}>Order summary</Text>
        <Text style={local.timer}>{minutesSeconds(cart.secondsLeft)}</Text>
      </View>
      <Text style={theme.styles.muted}>{ticketSlots.length} ticket holder{ticketSlots.length === 1 ? "" : "s"}</Text>
      {groupedItems.map((item) => (
        <View key={item.key} style={[local.summaryItem, { borderTopColor: theme.colors.line }]}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[local.summaryTitle, { color: theme.colors.ink }]}>{item.zone_name ?? "Ticket"}</Text>
            <Text numberOfLines={1} style={theme.styles.muted}>{item.match_title ?? `Match ${item.match_id}`}</Text>
            <Text style={theme.styles.muted}>{item.seats.length ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}` : `Qty ${item.quantity}`}</Text>
          </View>
          <Text style={[local.summaryPrice, { color: theme.colors.ink }]}>{formatMoney(item.subtotal, item.currency)}</Text>
        </View>
      ))}
      <View style={[local.summaryTotal, { borderTopColor: theme.colors.line }]}>
        <Text style={theme.styles.h2}>Total</Text>
        <Text style={theme.styles.h2}>{formatMoney(cart.total, cart.currency)}</Text>
      </View>
    </Card>
  );

  const renderPaymentMethod = () => (
    <Card>
      <Text style={theme.styles.h2}>Payment method</Text>
      <Text style={theme.styles.muted}>Choose how you want to pay.</Text>
      <View style={local.paymentGrid}>
        {paymentOptions.map((option) => {
          const active = paymentMethod === option.id;
          return (
            <Pressable
              key={option.id}
              disabled={isCheckoutLocked}
              onPress={() => setPaymentMethod(option.id)}
              style={[
                local.paymentOption,
                { backgroundColor: theme.colors.panel, borderColor: theme.colors.line },
                active && local.paymentOptionActive,
                isCheckoutLocked && local.lockedControl,
              ]}
            >
              <View style={[local.paymentIcon, { backgroundColor: theme.colors.panelSoft }, active && local.paymentIconActive]}>
                {option.id === "blue" ? <WalletGlyph active={active} /> : <CardGlyph active={active} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[local.paymentTitle, { color: theme.colors.ink }]}>{option.title}</Text>
                <Text style={theme.styles.muted}>{option.detail}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );

  const renderPaymentActions = () => (
    <Card>
      <Text style={theme.styles.h2}>Payment</Text>
      <View style={[local.paymentNotice, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
        <Text style={[local.paymentNoticeText, { color: theme.colors.secondary }]}>
          {paymentMethod === "cybersource"
            ? captureLoading
              ? "Preparing secure card checkout..."
              : captureError
                ? captureError
                : captureContext
                  ? "Secure card checkout is prepared."
                  : "Card checkout is not ready yet."
            : "Blue Wallet will open securely inside the app."}
        </Text>
      </View>
      {paymentMethod === "cybersource" && captureError ? (
        <Button title="Retry card setup" variant="secondary" disabled={isCheckoutLocked || captureLoading} onPress={() => cart.sessionId && void loadCaptureContext(cart.sessionId, true)} />
      ) : null}
      {paymentMethod === "cybersource" && captureContext && !isCheckoutLocked ? (
        <CybersourceUnifiedCheckout
          captureContext={captureContext}
          onSuccess={handleCardSuccess}
          onError={handleCardError}
        />
      ) : null}
      {paymentMethod === "blue" ? (
        <Button title={loading ? "Submitting..." : "Confirm and pay"} disabled={loading || !name || !email || !isCompleteLebanonPhone(phone) || !ticketSlots.length} onPress={() => void submit()} />
      ) : loading ? (
        <Text style={theme.styles.muted}>Confirming your order...</Text>
      ) : null}
      {/* {!auth.isAuthenticated ? <Button title="Login first" variant="secondary" disabled={isCheckoutLocked} onPress={() => router.push("/auth")} /> : null} */}
    </Card>
  );

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="Checkout" subtitle={cart.items.length ? "Review and pay securely" : "No active reservation"} hideCart />
        <ScrollView style={{ width: "100%" }} contentContainerStyle={{ width: "100%", gap: 12, paddingBottom: 28 }}>
          {!cart.items.length ? (
            <Empty title="Nothing to checkout" detail="Your reserved tickets will appear here." />
          ) : (
            <View style={[local.checkoutLayout, isWide && local.checkoutLayoutWide]}>
              <View style={[local.checkoutMain, isWide && local.checkoutMainWide]}>
                <Card>
                  <View style={theme.styles.row}>
                    <Text style={theme.styles.h2}>Billing</Text>
                    {billingInfoLoading ? <Text style={theme.styles.muted}>Loading saved info...</Text> : null}
                  </View>
                  <Input label="Name" value={name} onChangeText={setName} autoCapitalize="words" editable={!isCheckoutLocked} />
                  <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!isCheckoutLocked} />
                  <Input
                    label="Phone"
                    value={phone}
                    onChangeText={(value) => setPhone(formatLebanonPhone(value))}
                    onFocus={() => {
                      if (!phone.startsWith(LEBANON_DIAL_CODE)) setPhone(LEBANON_DIAL_CODE);
                    }}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    placeholder="+961 XX XXX XXX"
                    editable={!isCheckoutLocked}
                  />
                  <Input label="Country" value={CHECKOUT_COUNTRY_LABEL} editable={false} />
                </Card>

                <Card>
                  <Text style={theme.styles.h2}>Ticket holders</Text>
                  <Text style={theme.styles.muted}>Name printed on each ticket.</Text>
                  {ticketSlots.map((slot) => (
                    <Input
                      key={slot.key}
                      label={slot.label}
                      value={holderNames[slot.key] ?? ""}
                      onChangeText={(value) => setHolderNames((current) => ({ ...current, [slot.key]: value }))}
                      autoCapitalize="words"
                      editable={!isCheckoutLocked}
                    />
                  ))}
                </Card>

                <Card>
                  <Text style={theme.styles.h2}>Payment method</Text>
                  <Text style={theme.styles.muted}>Choose how you want to pay.</Text>
                  <View style={local.paymentGrid}>
                    {paymentOptions.map((option) => {
                      const active = paymentMethod === option.id;
                      return (
                        <Pressable
                          key={option.id}
                          disabled={isCheckoutLocked}
                          onPress={() => setPaymentMethod(option.id)}
                          style={[
                            local.paymentOption,
                            { backgroundColor: theme.colors.panel, borderColor: theme.colors.line },
                            active && local.paymentOptionActive,
                            isCheckoutLocked && local.lockedControl,
                          ]}
                        >
                          <View style={[local.paymentIcon, { backgroundColor: theme.colors.panelSoft }, active && local.paymentIconActive]}>
                            {option.id === "blue" ? <WalletGlyph active={active} /> : <CardGlyph active={active} />}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[local.paymentTitle, { color: theme.colors.ink }]}>{option.title}</Text>
                            <Text style={theme.styles.muted}>{option.detail}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </Card>
              </View>

              <View style={[local.checkoutAside, isWide && local.checkoutAsideWide]}>
                <Card>
                  <View style={theme.styles.row}>
                    <Text style={theme.styles.h2}>Order summary</Text>
                    <Text style={local.timer}>{minutesSeconds(cart.secondsLeft)}</Text>
                  </View>
                  <Text style={theme.styles.muted}>{ticketSlots.length} ticket holder{ticketSlots.length === 1 ? "" : "s"}</Text>
                  {groupedItems.map((item) => (
                    <View key={item.key} style={[local.summaryItem, { borderTopColor: theme.colors.line }]}>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={[local.summaryTitle, { color: theme.colors.ink }]}>{item.zone_name ?? "Ticket"}</Text>
                        <Text numberOfLines={1} style={theme.styles.muted}>{item.match_title ?? `Match ${item.match_id}`}</Text>
                        <Text style={theme.styles.muted}>{item.seats.length ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}` : `Qty ${item.quantity}`}</Text>
                      </View>
                      <Text style={[local.summaryPrice, { color: theme.colors.ink }]}>{formatMoney(item.subtotal, item.currency)}</Text>
                    </View>
                  ))}
                  <View style={[local.summaryTotal, { borderTopColor: theme.colors.line }]}>
                    <Text style={theme.styles.h2}>Total</Text>
                    <Text style={theme.styles.h2}>{formatMoney(cart.total, cart.currency)}</Text>
                  </View>
                </Card>

                <Card>
                  <Text style={theme.styles.h2}>Payment</Text>
                  <View style={[local.paymentNotice, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
                    <Text style={[local.paymentNoticeText, { color: theme.colors.secondary }]}>
                      {paymentMethod === "cybersource"
                        ? captureLoading
                          ? "Preparing secure card checkout..."
                          : captureError
                            ? captureError
                            : captureContext
                              ? "Secure card checkout is prepared."
                              : "Card checkout is not ready yet."
                        : "Blue Wallet will open securely inside the app."}
                    </Text>
                  </View>
                  {paymentMethod === "cybersource" && captureError ? (
                    <Button title="Retry card setup" variant="secondary" disabled={isCheckoutLocked || captureLoading} onPress={() => cart.sessionId && void loadCaptureContext(cart.sessionId, true)} />
                  ) : null}
                  {paymentMethod === "cybersource" && captureContext && !isCheckoutLocked ? (
                    <CybersourceUnifiedCheckout
                      captureContext={captureContext}
                      onSuccess={handleCardSuccess}
                      onError={handleCardError}
                    />
                  ) : null}
                  {paymentMethod === "blue" ? (
                    <Button title={loading ? "Submitting..." : "Confirm and pay"} disabled={loading || !name || !email || !isCompleteLebanonPhone(phone) || !ticketSlots.length} onPress={() => void submit()} />
                  ) : loading ? (
                    <Text style={theme.styles.muted}>Confirming your order...</Text>
                  ) : null}
                  {/* {!auth.isAuthenticated ? <Button title="Login first" variant="secondary" disabled={isCheckoutLocked} onPress={() => router.push("/auth")} /> : null} */}
                </Card>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
      {loading ? (
        <View style={local.overlay}>
          <View style={local.overlayPanel}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={local.overlayTitle}>Confirming your order...</Text>
            <Text style={theme.styles.muted}>Please do not close this page.</Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function createCheckoutStyles(colors: ThemeColors) {
  return {
  shell: { flex: 1, alignSelf: "center" as const },
  checkoutLayout: { gap: 12 },
  checkoutLayoutWide: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
  },
  checkoutMain: { gap: 12 },
  checkoutMainWide: {
    flex: 1,
    minWidth: 0,
  },
  checkoutAside: { gap: 12 },
  checkoutAsideWide: {
    width: 350,
    position: "sticky" as any,
    top: 0,
  },
  timer: { color: colors.primary, fontSize: 13, fontWeight: "900" as const },
  summaryItem: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  summaryTotal: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  summaryTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" as const },
  summaryPrice: { color: colors.ink, fontSize: 13, fontWeight: "900" as const },
  paymentGrid: { gap: 10 },
  paymentOption: {
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    padding: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  paymentOptionActive: { borderColor: colors.primary, backgroundColor: "rgba(200,16,46,0.06)" },
  paymentIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.panelSoft,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  paymentIconActive: { backgroundColor: colors.primary },
  paymentTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" as const },
  paymentNotice: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    padding: 12,
  },
  paymentNoticeText: { color: colors.secondary, fontSize: 13, lineHeight: 18 },
  lockedControl: { opacity: 0.62 },
  overlay: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(21,26,44,0.32)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 24,
  },
  overlayPanel: {
    width: "100%" as const,
    maxWidth: 320,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    padding: 18,
    alignItems: "center" as const,
    gap: 8,
  },
  overlayTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" as const },
  };
}

function WalletGlyph({ active }: { active: boolean }) {
  const theme = useTheme();
  const glyphColor = active ? "#FFFFFF" : theme.colors.ink;

  return (
    <View style={[localGlyph.wallet, { borderColor: glyphColor }]}>
      <View style={[localGlyph.walletLine, { backgroundColor: glyphColor }]} />
    </View>
  );
}

function CardGlyph({ active }: { active: boolean }) {
  const theme = useTheme();
  const glyphColor = active ? "#FFFFFF" : theme.colors.ink;

  return (
    <View style={[localGlyph.card, { borderColor: glyphColor }]}>
      <View style={[localGlyph.cardStripe, { backgroundColor: glyphColor }]} />
      <View style={[localGlyph.cardDot, { backgroundColor: glyphColor }]} />
    </View>
  );
}

const localGlyph = {
  wallet: {
    width: 22,
    height: 18,
    borderRadius: 5,
    borderWidth: 2,
    justifyContent: "center" as const,
    paddingHorizontal: 4,
  },
  walletLine: { height: 2, borderRadius: 1 },
  card: {
    width: 24,
    height: 17,
    borderRadius: 4,
    borderWidth: 2,
    paddingTop: 4,
    paddingHorizontal: 3,
  },
  cardStripe: { height: 2, borderRadius: 1 },
  cardDot: { width: 5, height: 2, borderRadius: 1, marginTop: 4 },
  activeBorder: { borderColor: "#FFFFFF" },
  activeFill: { backgroundColor: "#FFFFFF" },
};
