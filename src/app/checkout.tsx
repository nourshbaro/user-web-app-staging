import { AppHeader } from "@/components/AppHeader";
import { MatchSummaryBlock } from "@/components/MatchSummaryBlock";
import {
  PaymentMethodIcon,
  PaymentMethodSheet,
  type PaymentMethodOption,
} from "@/components/PaymentMethodSheet";
import { TicketHoldersBlock } from "@/components/TicketHoldersBlock";
import {
  Button,
  Card,
  Empty,
  Screen,
  useResponsive,
  useTheme,
  type ThemeColors,
} from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useTicketHolders } from "@/context/TicketHoldersContext";
import { useToast } from "@/context/ToastContext";
import {
  clearBluePaymentHandoff,
  createBluePaymentHandoff,
  readPendingBluePaymentAttempt,
  savePendingBluePaymentAttempt,
} from "@/lib/bluePaymentHandoff";
import { validateBluePaymentUrl } from "@/lib/bluePaymentRedirect";
import {
  beginCaptureContextRequest,
  invalidateCaptureContextRequestRefs,
  releaseCaptureContextRetry,
  shouldInitializeCaptureContext,
} from "@/lib/captureContextRequestGuard";
import {
  clearCardPaymentHandoff,
  createCardPaymentHandoff,
} from "@/lib/cardPaymentHandoff";
import { groupCartItems, type CartDisplayItem } from "@/lib/cartDisplay";
import {
  createCheckoutBilling,
  getActiveCaptureState,
  type CaptureState,
} from "@/lib/checkoutOwnership";
import { createCheckoutSubmissionAuthority } from "@/lib/checkoutSubmissionAuthority";
import { config } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { initializePhoneValue } from "@/lib/phoneNumber";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { paymentError, userFacingError } from "@/lib/userFacingError";
import { checkoutService } from "@/services/checkout";
import { router, Stack, useFocusEffect, useIsFocused } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

function getCheckoutOrigin() {
  if (Platform.OS === "web" && typeof window !== "undefined")
    return window.location.origin;
  return config.siteUrl;
}

function readCaptureContext(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as {
    capture_context?: unknown;
    data?: { capture_context?: unknown };
  };
  const value = record.data?.capture_context ?? record.capture_context;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Groups cart display items by match, preserving the order matches first appear in the cart. */
function groupByMatch(items: CartDisplayItem[]) {
  const order: string[] = [];
  const byMatch = new Map<string, CartDisplayItem[]>();
  items.forEach((item) => {
    if (!byMatch.has(item.match_id)) {
      order.push(item.match_id);
      byMatch.set(item.match_id, []);
    }
    byMatch.get(item.match_id)!.push(item);
  });
  return order.map((matchId) => ({
    matchId,
    matchTitle: byMatch.get(matchId)![0]?.match_title ?? `Match ${matchId}`,
    items: byMatch.get(matchId)!,
  }));
}

function CheckoutScreen() {
  const cart = useCart();
  const auth = useAuth();
  const { refreshUser } = auth;
  const responsive = useResponsive();
  const theme = useTheme();
  const local = useMemo(
    () => createCheckoutStyles(theme.colors),
    [theme.colors],
  );
  const toast = useToast();
  const isFocused = useIsFocused();
  const { ticketSlots, holderNames } = useTicketHolders();
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethodOption | null>(null);
  const [paymentSheetVisible, setPaymentSheetVisible] = useState(false);
  const [holdersExpanded, setHoldersExpanded] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const [loading, setLoading] = useState(false);
  const captureSessionRef = useRef<string | null>(null);
  const captureRetrySessionRef = useRef<string | null>(null);
  const capturePromiseRef = useRef<{
    sessionId: string;
    promise: Promise<string>;
  } | null>(null);
  const captureRequestAuthority = useMemo(() => createRequestAuthority(), []);
  const checkoutSubmissionAuthority = useMemo(
    () => createCheckoutSubmissionAuthority(),
    [],
  );
  const submitInFlightRef = useRef(false);
  const blueHandoffStartedRef = useRef(false);
  const name = auth.user?.name.trim() ?? "";
  const email = auth.user?.email.trim() ?? "";
  const canonicalPhone = initializePhoneValue(
    auth.user?.phone ?? "",
  ).canonicalPhone;
  const activeCaptureState = getActiveCaptureState(
    captureState,
    cart.sessionId,
  );
  const captureContext =
    activeCaptureState?.status === "ready" ? activeCaptureState.context : null;
  const captureError =
    activeCaptureState?.status === "error" ? activeCaptureState.error : null;
  const captureLoading =
    cart.sessionId !== null &&
    (activeCaptureState === null || activeCaptureState.status === "loading");
  const groupedItems = groupCartItems(cart.items);
  const matchGroups = useMemo(() => groupByMatch(groupedItems), [groupedItems]);
  const isCheckoutLocked = loading || auth.isRefreshingUser;
  const returnToCart = useCallback(() => router.replace("/cart"), []);

  useFocusEffect(
    useCallback(() => {
      // A BLUE route launch is single-flight only while Checkout is handing off.
      // Returning from an unresolved payment attempt must permit a fresh action.
      blueHandoffStartedRef.current = false;
      void refreshUser().catch(() => {});
    }, [refreshUser]),
  );

  const launchBluePayment = useCallback(
    (paymentUrl: string, sessionId: string) => {
      if (Platform.OS === "web" && typeof window === "undefined") {
        throw new Error("Blue payment navigation is unavailable.");
      }

      blueHandoffStartedRef.current = true;
      if (Platform.OS === "web") {
        try {
          window.location.assign(paymentUrl);
        } catch (error) {
          blueHandoffStartedRef.current = false;
          throw error;
        }
        return;
      }

      const handoffId = createBluePaymentHandoff(paymentUrl, sessionId);
      try {
        router.navigate({
          pathname: "/checkout/blue/payment",
          params: { handoff: handoffId },
        });
      } catch (error) {
        clearBluePaymentHandoff(handoffId);
        blueHandoffStartedRef.current = false;
        throw error;
      }
    },
    [],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        returnToCart();
        return true;
      },
    );
    return () => subscription.remove();
  }, [returnToCart]);

  useEffect(() => {
    if (isFocused && !cart.isLoading && !cart.sessionId && !cart.items.length)
      router.replace("/cart");
  }, [cart.isLoading, cart.items.length, cart.sessionId, isFocused]);

  const loadCaptureContext = useCallback(
    (sessionId: string, force = false): Promise<string> => {
      const existing = capturePromiseRef.current;
      if (!force && existing?.sessionId === sessionId) return existing.promise;
      const started = beginCaptureContextRequest(
        captureSessionRef,
        captureRetrySessionRef,
        sessionId,
        force,
      );
      if (!started) {
        return (
          existing?.promise ??
          Promise.reject(
            new Error("Payment preparation is already in progress."),
          )
        );
      }

      const ticket = captureRequestAuthority.begin(sessionId);

      setCaptureState({ sessionId, status: "loading" });
      const promise = (async () => {
        try {
          const response = await checkoutService.captureContext(sessionId, [
            getCheckoutOrigin(),
          ]);
          const context = readCaptureContext(response);
          if (!context) throw new Error("Payment form could not be prepared.");
          if (!captureRequestAuthority.isCurrent(ticket))
            throw new Error("Payment session changed.");
          setCaptureState({ sessionId, status: "ready", context });
          return context;
        } catch (err) {
          const message = userFacingError(
            err,
            "Could not prepare card payment. Please try again.",
          );
          if (captureRequestAuthority.isCurrent(ticket)) {
            captureSessionRef.current = null;
            setCaptureState({ sessionId, status: "error", error: message });
          }
          throw new Error(message);
        } finally {
          releaseCaptureContextRetry(captureRetrySessionRef, sessionId, force);
        }
      })();
      capturePromiseRef.current = { sessionId, promise };
      return promise;
    },
    [captureRequestAuthority],
  );

  useLayoutEffect(() => {
    captureRequestAuthority.invalidate(cart.sessionId);
    invalidateCaptureContextRequestRefs(
      captureSessionRef,
      captureRetrySessionRef,
      cart.sessionId,
    );
  }, [captureRequestAuthority, cart.sessionId]);

  useEffect(() => {
    const sessionId = cart.sessionId;
    if (!shouldInitializeCaptureContext(paymentMethod ?? "", sessionId)) return;

    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadCaptureContext(sessionId).catch(() => {});
    });
    return () => {
      active = false;
    };
  }, [cart.sessionId, loadCaptureContext, paymentMethod]);

  // Ticket-holder names are collected in the dedicated step-by-step flow
  // before checkout (see /checkout/ticket-holders). If the cart changed
  // since then (or this screen was reached directly), send the user back
  // there instead of allowing an incomplete submission.
  useEffect(() => {
    if (!cart.items.length || !ticketSlots.length) return;
    const missing = ticketSlots.some((slot) => !holderNames[slot.key]?.trim());
    if (missing) router.replace("/checkout/ticket-holders");
  }, [cart.items.length, holderNames, ticketSlots]);

  useEffect(() => {
    captureRequestAuthority.mount();
    checkoutSubmissionAuthority.mount();
    return () => {
      captureRequestAuthority.unmount();
      checkoutSubmissionAuthority.unmount();
      captureSessionRef.current = null;
      captureRetrySessionRef.current = null;
      capturePromiseRef.current = null;
    };
  }, [captureRequestAuthority, checkoutSubmissionAuthority]);

  const submitBlue = async () => {
    if (
      !cart.sessionId ||
      !paymentMethod ||
      submitInFlightRef.current ||
      blueHandoffStartedRef.current
    )
      return;

    const cartSessionTicket = cart.captureCartSession();
    if (!cartSessionTicket) return;

    const missingHolder = ticketSlots.find(
      (slot) => !holderNames[slot.key]?.trim(),
    );
    if (missingHolder) {
      toast.showToast({
        variant: "warning",
        title: "Ticket holder required",
        message: `Enter the holder name for ${missingHolder.label}.`,
      });
      router.replace("/checkout/ticket-holders");
      return;
    }

    const reusableAttempt = readPendingBluePaymentAttempt(
      cartSessionTicket.sessionId as string,
    );
    if (reusableAttempt) {
      try {
        launchBluePayment(
          reusableAttempt.paymentUrl,
          reusableAttempt.sessionId,
        );
      } catch (err) {
        toast.showToast({
          variant: "error",
          title: "Payment unavailable",
          message: userFacingError(err, paymentError()),
        });
      }
      return;
    }

    const checkoutBilling = createCheckoutBilling(name, email, canonicalPhone);

    if (!checkoutBilling) {
      toast.showToast({
        variant: "warning",
        title: "Profile phone number required",
        message: "Add a valid phone number to your profile to continue.",
      });
      return;
    }

    const submissionTicket = checkoutSubmissionAuthority.begin(
      cartSessionTicket.sessionId as string,
    );
    try {
      submitInFlightRef.current = true;
      setLoading(true);

      const ticketsByMatch = ticketSlots.reduce<
        Record<string, { holder_name: string }[]>
      >((acc, slot) => {
        acc[slot.matchId] = [
          ...(acc[slot.matchId] ?? []),
          { holder_name: holderNames[slot.key].trim() },
        ];
        return acc;
      }, {});

      const response = await checkoutService.submit({
        checkout_session_id: submissionTicket.sessionId,
        billing: checkoutBilling,
        tickets_by_match: ticketsByMatch,
        payment_method: "blue",
      });

      if (
        !checkoutSubmissionAuthority.isCurrent(submissionTicket) ||
        !cart.isCartSessionCurrent(cartSessionTicket)
      )
        return;

      const validatedUrl = validateBluePaymentUrl(
        response.payment?.payment_url,
        config.bluePaymentAllowedOrigin,
      );

      savePendingBluePaymentAttempt({
        sessionId: submissionTicket.sessionId,
        paymentUrl: validatedUrl,
        ...(response.order_id !== undefined
          ? { orderId: String(response.order_id) }
          : {}),
        ...(response.order_number !== undefined
          ? { orderNumber: String(response.order_number) }
          : {}),
        ...(response.reference !== undefined
          ? { reference: String(response.reference) }
          : {}),
        ...(response.payment_reference !== undefined
          ? { paymentReference: String(response.payment_reference) }
          : response.payment?.payment_reference !== undefined
            ? { paymentReference: String(response.payment.payment_reference) }
            : {}),
      });

      launchBluePayment(validatedUrl, submissionTicket.sessionId);
      return;
    } catch (err) {
      if (
        checkoutSubmissionAuthority.isCurrent(submissionTicket) &&
        cart.isCartSessionCurrent(cartSessionTicket)
      ) {
        toast.showToast({
          variant: "error",
          title: "Checkout failed",
          message: userFacingError(err, paymentError()),
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

  const canContinue =
    !isCheckoutLocked &&
    !!paymentMethod &&
    !!name &&
    !!email &&
    !!canonicalPhone &&
    !!ticketSlots.length &&
    !ticketSlots.some((slot) => !holderNames[slot.key]?.trim());

  const handleContinue = () => {
    if (!canContinue) return;
    if (paymentMethod === "cybersource") {
      const cartSessionTicket = cart.captureCartSession();
      const checkoutBilling = createCheckoutBilling(
        name,
        email,
        canonicalPhone,
      );
      if (!cartSessionTicket || !checkoutBilling) return;
      const ticketsByMatch = ticketSlots.reduce<
        Record<string, { holder_name: string }[]>
      >((acc, slot) => {
        acc[slot.matchId] = [
          ...(acc[slot.matchId] ?? []),
          { holder_name: holderNames[slot.key].trim() },
        ];
        return acc;
      }, {});
      const handoffId = createCardPaymentHandoff({
        sessionId: cartSessionTicket.sessionId as string,
        captureContext,
        prepareCaptureContext: (force = false) =>
          loadCaptureContext(cartSessionTicket.sessionId as string, force),
        request: {
          checkout_session_id: cartSessionTicket.sessionId as string,
          billing: checkoutBilling,
          tickets_by_match: ticketsByMatch,
          payment_method: "cybersource",
        },
      });
      try {
        router.navigate({
          pathname: "/checkout/card/payment",
          params: { handoff: handoffId },
        });
      } catch (error) {
        clearCardPaymentHandoff(handoffId);
        throw error;
      }
      return;
    }
    void submitBlue();
  };

  const paymentMethodLabel =
    paymentMethod === "cybersource"
      ? "Card"
      : paymentMethod === "blue"
        ? "BLUE Wallet"
        : null;

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader
          title="Checkout"
          subtitle={
            cart.items.length
              ? "Review and pay securely"
              : "No active reservation"
          }
          hideCart
          showTimer={Boolean(cart.items.length)}
          onBack={returnToCart}
        />
        <ScrollView
          style={{ width: "100%" }}
          contentContainerStyle={{ width: "100%", gap: 12, paddingBottom: 28 }}
        >
          {!cart.items.length ? (
            <Empty
              title="Nothing to checkout"
              detail="Your reserved tickets will appear here."
            />
          ) : (
            <>
              {matchGroups.map((group) => (
                <MatchSummaryBlock
                  key={group.matchId}
                  matchTitle={group.matchTitle}
                  items={group.items}
                />
              ))}

              <TicketHoldersBlock
                ticketSlots={ticketSlots}
                holderNames={holderNames}
                expanded={holdersExpanded}
                onToggle={() => setHoldersExpanded((value) => !value)}
              />

              <Card>
                <Text style={theme.styles.h2}>Pay with</Text>
                {auth.isRefreshingUser ? (
                  <Text style={theme.styles.muted}>
                    Loading profile info...
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => setPaymentSheetVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Select payment method"
                  style={[
                    local.payWithRow,
                    {
                      borderColor: theme.colors.line,
                      backgroundColor: theme.colors.panelSoft,
                    },
                  ]}
                >
                  <View style={local.payWithSelection}>
                    {paymentMethod ? (
                      <View
                        style={[
                          local.payWithIcon,
                          { backgroundColor: theme.colors.panel },
                        ]}
                      >
                        <PaymentMethodIcon method={paymentMethod} size={22} />
                      </View>
                    ) : null}
                    <Text
                      numberOfLines={1}
                      style={[local.payWithLabel, { color: theme.colors.ink }]}
                    >
                      {paymentMethodLabel ?? "Select payment method"}
                    </Text>
                  </View>
                  <SymbolView
                    name={{
                      ios: "chevron.right",
                      android: "chevron_right",
                      web: "chevron_right",
                    }}
                    size={20}
                    tintColor={theme.colors.muted}
                    fallback={<View />}
                  />
                </Pressable>
                {!canonicalPhone && !auth.isRefreshingUser ? (
                  <View
                    style={[
                      local.phoneNotice,
                      {
                        backgroundColor: theme.colors.panelSoft,
                        borderColor: theme.colors.line,
                      },
                    ]}
                  >
                    <Text style={theme.styles.muted}>
                      Add a phone number to your profile to complete checkout.
                    </Text>
                    <Button
                      title="Update profile"
                      variant="secondary"
                      onPress={() => router.push("/edit-profile")}
                    />
                  </View>
                ) : null}
                {paymentMethod === "cybersource" && captureError ? (
                  <Button
                    title="Retry card setup"
                    variant="secondary"
                    disabled={isCheckoutLocked || captureLoading}
                    onPress={() =>
                      cart.sessionId &&
                      void loadCaptureContext(cart.sessionId, true)
                    }
                  />
                ) : null}
              </Card>

              {paymentMethod ? (
                <Card>
                  <View
                    style={[
                      local.summaryTotal,
                      { borderTopColor: "transparent", paddingTop: 0 },
                    ]}
                  >
                    <Text style={theme.styles.h2}>Subtotal</Text>
                    <Text style={theme.styles.h2}>
                      {formatMoney(cart.total, cart.currency)}
                    </Text>
                  </View>
                  <Button
                    title={loading ? "Submitting..." : "Continue"}
                    disabled={!canContinue}
                    onPress={handleContinue}
                  />
                </Card>
              ) : null}

              <View style={local.termsNotice}>
                <Text style={[theme.styles.muted, local.termsText]}>
                  By confirming your order, you agree to{`\n`}
                  <Text
                    style={[local.termsTextStrong, { color: theme.colors.ink }]}
                  >
                    LFA General Terms and Conditions
                  </Text>{" "}
                  and{" "}
                  <Text
                    style={[local.termsTextStrong, { color: theme.colors.ink }]}
                  >
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>

      <PaymentMethodSheet
        visible={paymentSheetVisible}
        onClose={() => setPaymentSheetVisible(false)}
        selected={paymentMethod}
        onSelect={setPaymentMethod}
      />

      {loading ? (
        <View style={local.overlay}>
          <View style={local.overlayPanel}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={local.overlayTitle}>Confirming your order...</Text>
            <Text style={theme.styles.muted}>
              Please do not close this page.
            </Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function createCheckoutStyles(colors: ThemeColors) {
  return {
    shell: { flex: 1, alignSelf: "center" as const },
    summaryTotal: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: 12,
    },
    payWithRow: {
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 14,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 10,
    },
    payWithSelection: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
    },
    payWithIcon: {
      width: 38,
      height: 38,
      borderRadius: 11,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      flexShrink: 0,
    },
    payWithLabel: { flexShrink: 1, fontSize: 15, fontWeight: "800" as const },
    phoneNotice: {
      borderRadius: 14,
      borderWidth: 1,
      padding: 12,
      gap: 10,
    },
    termsNotice: {
      alignItems: "center" as const,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    termsText: {
      textAlign: "center" as const,
    },
    termsTextStrong: {
      fontWeight: "700" as const,
    },
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
    overlayTitle: {
      color: colors.ink,
      fontSize: 16,
      fontWeight: "900" as const,
    },
    cardModalScreen: { flex: 1 },
    cardModalHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    cardModalBack: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 6,
      minHeight: 40,
      borderRadius: 14,
      borderWidth: 1,
      paddingHorizontal: 12,
    },
    backChevron: {
      width: 9,
      height: 9,
      borderLeftWidth: 2,
      borderBottomWidth: 2,
      transform: [{ rotate: "45deg" }],
    },
    cardModalBody: { flexGrow: 1, padding: 16 },
  };
}

export default withAuthRequired(CheckoutScreen);
