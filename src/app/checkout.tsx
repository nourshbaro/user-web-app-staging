import { AppHeader } from "@/components/AppHeader";
import { CybersourceUnifiedCheckout } from "@/components/CybersourceUnifiedCheckout";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { Button, Card, Empty, Input, Screen, useResponsive, useTheme, type ThemeColors } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { clearBluePaymentHandoff, createBluePaymentHandoff } from "@/lib/bluePaymentHandoff";
import { validateBluePaymentUrl } from "@/lib/bluePaymentRedirect";
import { groupCartItems } from "@/lib/cartDisplay";
import {
  beginCaptureContextRequest,
  invalidateCaptureContextRequestRefs,
  releaseCaptureContextRetry,
  shouldInitializeCaptureContext,
} from "@/lib/captureContextRequestGuard";
import {
  createCheckoutBilling,
  getActiveBillingForm,
  getActiveCaptureState,
  type BillingFormState,
  type CaptureState,
} from "@/lib/checkoutOwnership";
import { checkoutResultRouteParams, parseCheckoutResultParams } from "@/lib/checkoutResultParams";
import { createCheckoutSubmissionAuthority } from "@/lib/checkoutSubmissionAuthority";
import { config } from "@/lib/config";
import { formatMoney, minutesSeconds } from "@/lib/format";
import {
  DEFAULT_PHONE_COUNTRY,
  createEmptyPhoneValue,
  initializePhoneValue,
} from "@/lib/phoneNumber";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { profileService } from "@/services/auth";
import { checkoutService } from "@/services/checkout";
import type { CartSessionTicket } from "@/lib/cartSessionAuthority";
import type { CheckoutSubmitRequest } from "@/types";
import { router } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";

type PaymentMethod = CheckoutSubmitRequest["payment_method"];
type BillingInfoPayload = Record<string, unknown>;

const paymentOptions: { id: PaymentMethod; title: string; detail: string }[] = [
  { id: "blue", title: "Blue Wallet", detail: "Redirect to Blue to complete payment." },
  { id: "cybersource", title: "Credit / Debit Card", detail: "Visa and Mastercard secure checkout." },
];
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
  const [billingForm, setBillingForm] = useState<BillingFormState | null>(null);
  const [holderNames, setHolderNames] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("blue");
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const [billingRequestState, setBillingRequestState] = useState<{ owner: string; status: "loading" | "ready" } | null>(null);
  const [loading, setLoading] = useState(false);
  const captureSessionRef = useRef<string | null>(null);
  const captureRetrySessionRef = useRef<string | null>(null);
  const captureRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const billingRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const billingProfileRef = useRef<{ owner: string | null; name: string; email: string }>({
    owner: auth.userCacheKey,
    name: auth.user?.name ?? "",
    email: auth.user?.email ?? "",
  });
  const checkoutSubmissionAuthority = useMemo(
    () => createCheckoutSubmissionAuthority(),
    [],
  )
  const submitInFlightRef = useRef(false);
  const blueHandoffStartedRef = useRef(false);
  const billingOwner = auth.isReady && auth.isAuthenticated ? auth.userCacheKey : null;
  const billingFallback = useMemo<BillingFormState>(() => ({
    owner: billingOwner,
    name: auth.user?.name ?? "",
    email: auth.user?.email ?? "",
    phoneCountry: DEFAULT_PHONE_COUNTRY,
    phoneNationalValue: "",
    canonicalPhone: null,
  }), [auth.user?.email, auth.user?.name, billingOwner]);
  const activeBillingForm = getActiveBillingForm(billingForm, billingOwner, billingFallback);
  const {
    name,
    email,
    phoneCountry,
    phoneNationalValue,
    canonicalPhone,
  } = activeBillingForm;
  const phoneError =
    phoneNationalValue && !canonicalPhone
      ? "Enter a valid phone number for the selected phone country."
      : undefined;
  const billingInfoLoading =
    billingOwner !== null
    && (billingRequestState?.owner !== billingOwner || billingRequestState.status === "loading");
  const activeCaptureState = getActiveCaptureState(captureState, cart.sessionId);
  const captureContext = activeCaptureState?.status === "ready" ? activeCaptureState.context : null;
  const captureError = activeCaptureState?.status === "error" ? activeCaptureState.error : null;
  const captureLoading =
    cart.sessionId !== null
    && (activeCaptureState === null || activeCaptureState.status === "loading");
  const groupedItems = groupCartItems(cart.items);
  const isCheckoutLocked = loading;
  // Native tablets can rotate without inheriting the web-only sticky two-column layout.
  const isWide = Platform.OS === "web" && responsive.width >= 920;

  const updateBillingForm = useCallback((updates: Partial<Omit<BillingFormState, "owner">>) => {
    setBillingForm((current) => ({
      ...(current?.owner === billingOwner ? current : billingFallback),
      ...updates,
      owner: billingOwner,
    }));
  }, [billingFallback, billingOwner]);

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
    const started = beginCaptureContextRequest(
      captureSessionRef,
      captureRetrySessionRef,
      sessionId,
      force,
    );
    if (!started) return;

    const ticket = captureRequestAuthority.begin(sessionId);

    setCaptureState({ sessionId, status: "loading" });
    try {
      const response = await checkoutService.captureContext(sessionId, [getCheckoutOrigin()]);
      const context = readCaptureContext(response);
      if (!context) throw new Error("Empty Cybersource capture context.");
      if (!captureRequestAuthority.isCurrent(ticket)) return;
      setCaptureState({ sessionId, status: "ready", context });
    } catch (err) {
      if (!captureRequestAuthority.isCurrent(ticket)) return;
      captureSessionRef.current = null;
      setCaptureState({
        sessionId,
        status: "error",
        error: err instanceof Error ? err.message : "Could not prepare card payment.",
      });
    } finally {
      releaseCaptureContextRetry(captureRetrySessionRef, sessionId, force);
    }
  }, [captureRequestAuthority]);

  const loadBillingInfo = useCallback(async (owner: string) => {
    const ticket = billingRequestAuthority.begin(owner);
    const profile = billingProfileRef.current;
    setBillingRequestState({ owner, status: "loading" });

    try {
      const payload = await profileService.billingInfo();
      if (!billingRequestAuthority.isCurrent(ticket)) return;
      const nextBillingInfo = readBillingInfo(payload);
      const restoredPhone = initializePhoneValue(nextBillingInfo.phone);

      setBillingForm({
        owner,
        name: nextBillingInfo.name || profile.name,
        email: nextBillingInfo.email || profile.email,
        phoneCountry: restoredPhone.phoneCountry,
        phoneNationalValue: restoredPhone.phoneNationalValue,
        canonicalPhone: restoredPhone.canonicalPhone,
      });
    } catch {
      if (!billingRequestAuthority.isCurrent(ticket)) return;
      const emptyPhone = createEmptyPhoneValue();

      setBillingForm({
        owner,
        name: profile.name,
        email: profile.email,
        phoneCountry: emptyPhone.phoneCountry,
        phoneNationalValue: emptyPhone.phoneNationalValue,
        canonicalPhone: emptyPhone.canonicalPhone,
      });
    } finally {
      if (!billingRequestAuthority.isCurrent(ticket)) return;
      setBillingRequestState({ owner, status: "ready" });
    }
  }, [billingRequestAuthority]);

  useLayoutEffect(() => {
    billingProfileRef.current = {
      owner: billingOwner,
      name: auth.user?.name ?? "",
      email: auth.user?.email ?? "",
    };
  }, [auth.user?.email, auth.user?.name, billingOwner]);

  useLayoutEffect(() => {
    captureRequestAuthority.invalidate(cart.sessionId);
    invalidateCaptureContextRequestRefs(
      captureSessionRef,
      captureRetrySessionRef,
      cart.sessionId,
    );
  }, [captureRequestAuthority, cart.sessionId]);

  useLayoutEffect(() => {
    billingRequestAuthority.invalidate(billingOwner);
  }, [billingOwner, billingRequestAuthority]);

  useEffect(() => {
    const sessionId = cart.sessionId;
    if (!shouldInitializeCaptureContext(paymentMethod, sessionId)) return;

    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadCaptureContext(sessionId);
    });
    return () => {
      active = false;
    };
  }, [cart.sessionId, loadCaptureContext, paymentMethod]);

  useEffect(() => {
    if (!billingOwner) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadBillingInfo(billingOwner);
    });
    return () => {
      active = false;
    };
  }, [billingOwner, loadBillingInfo]);

  const dismissAllRoutes = () => {
    const resetRouter = router as typeof router & { dismissAll?: () => void };
    resetRouter.dismissAll?.();
  };

  useEffect(() => {
    captureRequestAuthority.mount();
    billingRequestAuthority.mount();
    checkoutSubmissionAuthority.mount();
    return () => {
      captureRequestAuthority.unmount();
      billingRequestAuthority.unmount();
      checkoutSubmissionAuthority.unmount();
      captureSessionRef.current = null;
      captureRetrySessionRef.current = null;
    };
  }, [billingRequestAuthority, captureRequestAuthority, checkoutSubmissionAuthority]);

  const submit = async (transientToken?: string) => {
    if (!cart.sessionId || submitInFlightRef.current || blueHandoffStartedRef.current) return;

    const cartSessionTicket = cart.captureCartSession();
    if (!cartSessionTicket) return;

    const missingHolder = ticketSlots.find((slot) => !holderNames[slot.key]?.trim());
    if (missingHolder) {
      toast.showToast({
        variant: "warning",
        title: "Ticket holder required",
        message: `Enter the holder name for ${missingHolder.label}.`,
      });
      return;
    }

    const checkoutBilling = createCheckoutBilling(
      name,
      email,
      canonicalPhone,
    );

    if (!checkoutBilling) {
      toast.showToast({
        variant: "warning",
        title: "Valid phone required",
        message: "Select a phone country and enter a valid phone number.",
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

    const submissionTicket = checkoutSubmissionAuthority.begin(
      cartSessionTicket.sessionId as string,
    );
    let publicationCartTicket: CartSessionTicket = cartSessionTicket;

    try {
      submitInFlightRef.current = true;
      setLoading(true);

      const ticketsByMatch = ticketSlots.reduce<Record<string, { holder_name: string }[]>>((acc, slot) => {
        acc[slot.matchId] = [...(acc[slot.matchId] ?? []), { holder_name: holderNames[slot.key].trim() }];
        return acc;
      }, {});

      const response = await checkoutService.submit({
        checkout_session_id: submissionTicket.sessionId,
        billing: checkoutBilling,
        tickets_by_match: ticketsByMatch,
        payment_method: paymentMethod,
        ...(transientToken ? { payment: { transient_token: transientToken } } : {}),
      });

      if (
        !checkoutSubmissionAuthority.isCurrent(submissionTicket)
        || !cart.isCartSessionCurrent(cartSessionTicket)
      ) return;

      if (paymentMethod === "blue") {
        const validatedUrl = validateBluePaymentUrl(
          response.payment?.payment_url,
          config.bluePaymentAllowedOrigin,
        );

        if (Platform.OS === "web" && typeof window === "undefined") {
          throw new Error("Blue payment navigation is unavailable.");
        }

        const clearedCartTicket = await cart.clearCartIfSession(cartSessionTicket);
        if (!clearedCartTicket) return;
        publicationCartTicket = clearedCartTicket;

        if (
          !checkoutSubmissionAuthority.isCurrent(submissionTicket)
          || !cart.isCartSessionCurrent(clearedCartTicket)
        ) return;

        blueHandoffStartedRef.current = true;

        if (Platform.OS === "web") {
          try {
            window.location.assign(validatedUrl);
          } catch (error) {
            blueHandoffStartedRef.current = false;
            throw error;
          }
          return;
        }

        const handoffId = createBluePaymentHandoff(validatedUrl);
        try {
          dismissAllRoutes();
          router.replace({
            pathname: "/checkout/blue/payment",
            params: { handoff: handoffId },
          });
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

      if (
        !checkoutSubmissionAuthority.isCurrent(submissionTicket)
        || !cart.isCartSessionCurrent(cartSessionTicket)
      ) return;

      const clearedCartTicket = await cart.clearCartIfSession(cartSessionTicket);
      if (!clearedCartTicket) return;
      publicationCartTicket = clearedCartTicket;

      if (
        !checkoutSubmissionAuthority.isCurrent(submissionTicket)
        || !cart.isCartSessionCurrent(clearedCartTicket)
      ) return;

      dismissAllRoutes();
      router.replace({ pathname: "/checkout/success", params: resultParams });
    } catch (err) {
      if (
        checkoutSubmissionAuthority.isCurrent(submissionTicket)
        && cart.isCartSessionCurrent(publicationCartTicket)
      ) {
        toast.showToast({
          variant: "error",
          title: "Checkout failed",
          message: err instanceof Error ? err.message : "Please try again.",
          duration: 6200,
        });
      }
    } finally {
      if (checkoutSubmissionAuthority.finish(submissionTicket)) {
        submitInFlightRef.current = false;
        setLoading(false);
      }
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
                  <Input label="Name" value={name} onChangeText={(value) => updateBillingForm({ name: value })} autoCapitalize="words" editable={!isCheckoutLocked} />
                  <Input label="Email" value={email} onChangeText={(value) => updateBillingForm({ email: value })} keyboardType="email-address" autoCapitalize="none" editable={!isCheckoutLocked} />
                  <InternationalPhoneInput
                    value={{
                      phoneCountry,
                      phoneNationalValue,
                      canonicalPhone,
                      validation: canonicalPhone
                        ? "valid"
                        : phoneNationalValue
                          ? "invalid"
                          : "empty",
                    }}
                    error={phoneError}
                    disabled={isCheckoutLocked}
                    onChange={(phoneValue) => {
                      updateBillingForm({
                        phoneCountry: phoneValue.phoneCountry,
                        phoneNationalValue: phoneValue.phoneNationalValue,
                        canonicalPhone: phoneValue.canonicalPhone,
                      });
                    }}
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
                    <Button
                      title={loading ? "Submitting..." : "Confirm and pay"}
                      disabled={
                        loading ||
                        !name ||
                        !email ||
                        !canonicalPhone ||
                        !ticketSlots.length
                      }
                      onPress={() => void submit()}
                    />) : loading ? (
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
