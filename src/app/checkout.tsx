import { AppHeader } from "@/components/AppHeader";
import { CartNotice } from "@/components/cart/CartNotice";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { ReservationStatus } from "@/components/cart/ReservationStatus";
import { PaymentMethodOptions } from "@/components/checkout/PaymentMethodOptions";
import { AppText, SectionHeader, StatePanel, TransactionBar } from "@/components/foundation";
import type { PaymentMethodOption } from "@/components/PaymentMethodSheet";
import { TicketHoldersBlock } from "@/components/TicketHoldersBlock";
import { Screen, useResponsive, useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useTicketHolders } from "@/context/TicketHoldersContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { errorFacts } from "@/lib/apiErrorFacts";
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
import { groupCartItems } from "@/lib/cartDisplay";
import {
  buildTicketsByMatch,
  checkoutAttemptBlocks,
  checkoutReadiness,
  holderCompleteness,
  paymentFailureKind,
  paymentSubmitBlocker,
  submissionGuard,
} from "@/lib/checkoutFlow";
import { reconciliationActive } from "@/lib/cartReconciliation";
import {
  acquirePaymentAttempt,
  isPaymentAttemptHeldByOther,
  markPaymentOutcomeUnknown,
  readPaymentAttempt,
  readPaymentOutcomeLock,
  settlePaymentAttempt,
  type PaymentAttempt,
} from "@/lib/paymentOutcomeLock";
import {
  createCheckoutBilling,
  getActiveCaptureState,
  type CaptureState,
} from "@/lib/checkoutOwnership";
import { createCheckoutSubmissionAuthority } from "@/lib/checkoutSubmissionAuthority";
import { config } from "@/lib/config";
import { radius, spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import { initializePhoneValue } from "@/lib/phoneNumber";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { paymentError, userFacingError } from "@/lib/userFacingError";
import { checkoutService } from "@/services/checkout";
import { router, Stack, useFocusEffect, useIsFocused } from "expo-router";
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
  ScrollView,
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

function CheckoutScreen() {
  const cart = useCart();
  const auth = useAuth();
  const { refreshUser } = auth;
  const responsive = useResponsive();
  const theme = useTheme();
  const i18n = useI18n();
  const toast = useToast();
  const isFocused = useIsFocused();
  const { ticketSlots, holderNames } = useTicketHolders();
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethodOption | null>(null);
  const [holdersExpanded, setHoldersExpanded] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const [loading, setLoading] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const [refreshingCart, setRefreshingCart] = useState(false);
  // Session whose payment has an unknown outcome (see paymentOutcomeLock).
  // Mirrored into state so the screen re-renders; the lock itself is the
  // session-scoped module state and survives leaving this screen.
  const [paymentLockSession, setPaymentLockSession] = useState<string | null>(
    () => readPaymentOutcomeLock(cart.sessionId)?.sessionId ?? null,
  );
  // Bumped to re-render after the shared attempt gate may have changed.
  const [gateVersion, setGateVersion] = useState(0);
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
  const holders = holderCompleteness(ticketSlots, holderNames);
  // Two columns (summary | payment) on wide screens instead of a stretched phone column.
  const twoColumn = responsive.width >= 1024;
  const isCheckoutLocked = loading || auth.isRefreshingUser;
  const returnToCart = useCallback(() => router.replace("/cart"), []);

  useFocusEffect(
    useCallback(() => {
      // A BLUE route launch is single-flight only while Checkout is handing off.
      // Returning from an unresolved payment attempt must permit a fresh action.
      blueHandoffStartedRef.current = false;
      // Returning from a payment screen may have locked this session or
      // changed its attempt gate: re-read both from their owner.
      setPaymentLockSession(readPaymentOutcomeLock(cart.sessionId)?.sessionId ?? null);
      setGateVersion((version) => version + 1);
      void refreshUser().catch(() => {});
    }, [cart.sessionId, refreshUser]),
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
        title: i18n.t("checkout.holderRequired.title"),
        message: i18n.t("checkout.holderRequired.message", { ticket: missingHolder.label }),
      });
      router.replace("/checkout/ticket-holders");
      return;
    }

    const reusableAttempt = readPendingBluePaymentAttempt(
      cartSessionTicket.sessionId as string,
    );
    if (reusableAttempt) {
      // Continuing the held BLUE attempt reopens its own URL; nothing is
      // submitted. If a provider failure redirect released the session's
      // gate, reopening re-acquires it first (so Card stays blocked while
      // the BLUE page is open again). Another method's attempt blocks it.
      const held = readPaymentAttempt(reusableAttempt.sessionId);
      if (held && held.method !== "blue") {
        toast.showToast({
          variant: "warning",
          title: i18n.t("checkout.submitBlocked.title"),
          message: i18n.t("checkout.blocker.attemptInProgress"),
        });
        return;
      }
      if (!held) {
        submitInFlightRef.current = true;
        const acquisition = await acquirePaymentAttempt(reusableAttempt.sessionId, "blue");
        submitInFlightRef.current = false;
        if (!acquisition.ok || !cart.isCartSessionCurrent(cartSessionTicket)) {
          if (acquisition.ok) void settlePaymentAttempt(reusableAttempt.sessionId, acquisition.attempt.id);
          toast.showToast({
            variant: "warning",
            title: i18n.t("checkout.submitBlocked.title"),
            message: i18n.t(!acquisition.ok && acquisition.reason === "notRecorded" ? "payment.notStarted" : "checkout.blocker.attemptInProgress"),
          });
          return;
        }
      }
      try {
        launchBluePayment(
          reusableAttempt.paymentUrl,
          reusableAttempt.sessionId,
        );
      } catch {
        toast.showToast({
          variant: "error",
          title: i18n.t("payment.unavailable.title"),
          message: paymentError(),
        });
      }
      return;
    }

    const checkoutBilling = createCheckoutBilling(name, email, canonicalPhone);

    if (!checkoutBilling) {
      toast.showToast({
        variant: "warning",
        title: i18n.t("checkout.phoneRequired.title"),
        message: i18n.t("checkout.phoneRequired.message"),
      });
      return;
    }

    const submissionTicket = checkoutSubmissionAuthority.begin(
      cartSessionTicket.sessionId as string,
    );
    let attempt: PaymentAttempt | null = null;
    try {
      submitInFlightRef.current = true;
      setLoading(true);

      const ticketsByMatch = buildTicketsByMatch(ticketSlots, holderNames);

      // Acquire the session's one payment attempt (shared with Card) and
      // persist it before anything can reach the backend, so neither another
      // surface nor a process restart can start a second payment.
      const acquisition = await acquirePaymentAttempt(submissionTicket.sessionId, "blue");
      if (!acquisition.ok) {
        if (checkoutSubmissionAuthority.isCurrent(submissionTicket)) {
          toast.showToast({
            variant: "error",
            title: i18n.t("payment.unavailable.title"),
            message: i18n.t(acquisition.reason === "blocked" ? "checkout.blocker.attemptInProgress" : "payment.notStarted"),
          });
        }
        return;
      }
      attempt = acquisition.attempt;
      // Last check against the owner, immediately before the submit. This
      // attempt passes its own gate; nothing else would.
      const owner = cart.readCartGuardState();
      const blocker = paymentSubmitBlocker({
        sessionId: submissionTicket.sessionId,
        owner: {
          ...owner,
          paymentOutcomeUnknown: readPaymentOutcomeLock(submissionTicket.sessionId) !== null,
          paymentAttemptInProgress: isPaymentAttemptHeldByOther(submissionTicket.sessionId, attempt),
        },
      });
      if (blocker || !cart.isCartSessionCurrent(cartSessionTicket)) {
        await settlePaymentAttempt(submissionTicket.sessionId, attempt.id);
        return;
      }

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
      const failure = paymentFailureKind(errorFacts(err));
      // Decided for the attempt's own session even if this screen is gone,
      // so an unknown outcome is never left unlocked.
      if (cart.isCartSessionCurrent(cartSessionTicket)) {
        if (failure === "unknown") markPaymentOutcomeUnknown(submissionTicket.sessionId, "blue");
        else if (attempt) void settlePaymentAttempt(submissionTicket.sessionId, attempt.id);
      }
      if (
        checkoutSubmissionAuthority.isCurrent(submissionTicket) &&
        cart.isCartSessionCurrent(cartSessionTicket)
      ) {
        // Catalog copy only. An unknown outcome (network, timeout, server
        // error) may have created the order, so it never reads as a failure.
        if (failure === "unknown") {
          // No trustworthy answer: the order may exist. Block paying again
          // for this session (backend idempotency is not established).
          setPaymentLockSession(submissionTicket.sessionId);
        }
        toast.showToast({
          variant: "error",
          title: i18n.t("checkout.submitFailed.title"),
          message:
            failure === "notCompleted"
              ? i18n.t("checkout.submitFailed.notCompleted")
              : failure === "session"
                ? i18n.t("payment.failed.session")
                : failure === "maintenance"
                  ? i18n.t("ticketError.maintenance")
                  : i18n.t("checkout.submitFailed.unknown"),
          duration: 6200,
        });
      }
    } finally {
      if (checkoutSubmissionAuthority.finish(submissionTicket)) {
        submitInFlightRef.current = false;
        setLoading(false);
        setGateVersion((version) => version + 1);
      }
    }
  };

  const reconciliationRequired = reconciliationActive(cart.cartReconciliation, cart.sessionId);
  const paymentOutcomeUnknown = paymentLockSession !== null && paymentLockSession === cart.sessionId;
  // The shared session gate, read from its owner (re-read on focus via gateVersion).
  const attemptBlocksCheckout = (sessionId: string | null) =>
    checkoutAttemptBlocks({
      heldMethod: readPaymentAttempt(sessionId)?.method ?? null,
      paymentMethod,
      hasReusableBlueAttempt: sessionId !== null && readPendingBluePaymentAttempt(sessionId) !== null,
    });
  // gateVersion is part of the expression so a memoizing compiler re-reads the
  // module-owned gate whenever it is bumped (focus, end of a BLUE submit).
  const paymentAttemptInProgress = gateVersion >= 0 && attemptBlocksCheckout(cart.sessionId);
  const readiness = checkoutReadiness({
    itemCount: cart.items.length,
    secondsLeft: cart.secondsLeft,
    reconciliationRequired,
    paymentOutcomeUnknown,
    paymentAttemptInProgress,
    locked: isCheckoutLocked,
    holdersComplete: holders.allComplete,
    paymentMethod,
    profileComplete: !!name && !!email,
    phoneValid: !!canonicalPhone,
  });
  const canContinue = readiness.ready;

  const handleContinue = () => {
    if (!canContinue) return;
    // Re-validate at the moment of the press against the owner's current
    // state (not the last render): a cart that changed, expired, became
    // unconfirmed or has an unknown payment can never start a handoff.
    const ownerState = cart.readCartGuardState();
    const lock = readPaymentOutcomeLock(ownerState.sessionId);
    const guard = submissionGuard({
      renderedSessionId: cart.sessionId,
      owner: {
        ...ownerState,
        paymentOutcomeUnknown: lock !== null,
        paymentAttemptInProgress: attemptBlocksCheckout(ownerState.sessionId),
      },
      inFlight: submitInFlightRef.current || blueHandoffStartedRef.current || isCheckoutLocked,
      holdersComplete: holderCompleteness(ticketSlots, holderNames).allComplete,
      paymentMethod,
      profileComplete: !!name && !!email,
      phoneValid: !!canonicalPhone,
    });
    if (!guard.ok) {
      if (lock) setPaymentLockSession(lock.sessionId);
      if (guard.blocker && guard.blocker !== "busy") {
        toast.showToast({
          variant: "warning",
          title: i18n.t("checkout.submitBlocked.title"),
          message: i18n.t(`checkout.blocker.${guard.blocker}`),
        });
      }
      return;
    }
    if (paymentMethod === "cybersource") {
      const cartSessionTicket = cart.captureCartSession();
      const checkoutBilling = createCheckoutBilling(
        name,
        email,
        canonicalPhone,
      );
      if (!cartSessionTicket || !checkoutBilling) return;
      const ticketsByMatch = buildTicketsByMatch(ticketSlots, holderNames);
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

  const payLabel =
    paymentMethod === "cybersource"
      ? i18n.t("checkout.pay.card")
      : paymentMethod === "blue"
        ? i18n.t("checkout.pay.blue")
        : i18n.t("checkout.pay.choose");
  const blockerMessage =
    readiness.blocker && readiness.blocker !== "busy"
      ? i18n.t(`checkout.blocker.${readiness.blocker}`)
      : null;
  const hasItems = cart.items.length > 0;

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader
          title={i18n.t("checkout.title")}
          subtitle={hasItems ? i18n.t("checkout.subtitle") : i18n.t("cart.noReservation")}
          hideCart
          onBack={returnToCart}
        />
        <ScrollView
          style={local.scroll}
          contentContainerStyle={[
            local.content,
            { paddingBottom: hasItems ? barHeight + spacing.lg : spacing.xxxl },
          ]}
        >
          {!hasItems ? (
            <StatePanel
              variant="empty"
              title={i18n.t("checkout.empty.title")}
              message={i18n.t("checkout.empty.message")}
            />
          ) : (
            <View style={[local.layout, twoColumn && local.layoutWide]}>
              <View style={[local.column, twoColumn && local.mainColumn]}>
                <ReservationStatus secondsLeft={cart.secondsLeft} />
                {paymentOutcomeUnknown ? (
                  <StatePanel
                    variant="info"
                    title={i18n.t("checkout.paymentUnknown.title")}
                    message={i18n.t("checkout.paymentUnknown.message")}
                    action={{ label: i18n.t("payment.viewTickets"), onPress: () => router.replace("/tickets") }}
                  />
                ) : reconciliationRequired ? (
                  <CartNotice
                    message={i18n.t("checkout.reconcile.message")}
                    action={{
                      label: i18n.t("cart.check.action"),
                      busy: refreshingCart,
                      onPress: () => {
                        if (refreshingCart) return;
                        setRefreshingCart(true);
                        void cart.refreshCart()
                          .catch(() => undefined)
                          .finally(() => setRefreshingCart(false));
                      },
                    }}
                  />
                ) : null}
                <OrderSummary
                  lines={groupedItems}
                  totalLabel={formatMoney(cart.total, cart.currency)}
                />
                <TicketHoldersBlock
                  ticketSlots={ticketSlots}
                  holderNames={holderNames}
                  expanded={holdersExpanded}
                  onToggle={() => setHoldersExpanded((value) => !value)}
                />
              </View>

              <View style={[local.column, twoColumn && local.sideColumn]}>
                <View style={[local.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <SectionHeader title={i18n.t("checkout.payment.title")} />
                  {auth.isRefreshingUser ? (
                    <AppText variant="meta" tone="muted" accessibilityLiveRegion="polite">
                      {i18n.t("checkout.profile.loading")}
                    </AppText>
                  ) : null}
                  <PaymentMethodOptions
                    selected={paymentMethod}
                    disabled={isCheckoutLocked}
                    onSelect={setPaymentMethod}
                    status={{
                      cybersource: captureError ? (
                        <CartNotice
                          tone="danger"
                          message={i18n.t("checkout.payment.cardError")}
                          action={{
                            label: i18n.t("checkout.payment.cardRetry"),
                            disabled: isCheckoutLocked || captureLoading,
                            onPress: () => {
                              if (cart.sessionId) void loadCaptureContext(cart.sessionId, true).catch(() => {});
                            },
                          }}
                        />
                      ) : captureLoading ? (
                        <View style={local.inlineStatus} accessibilityLiveRegion="polite">
                          <ActivityIndicator size="small" color={theme.colors.textMuted} />
                          <AppText variant="caption" tone="muted">{i18n.t("checkout.payment.cardPreparing")}</AppText>
                        </View>
                      ) : null,
                    }}
                  />
                  {!canonicalPhone && !auth.isRefreshingUser ? (
                    <CartNotice
                      message={i18n.t("checkout.phone.message")}
                      action={{
                        label: i18n.t("checkout.phone.action"),
                        onPress: () => router.push("/edit-profile"),
                      }}
                    />
                  ) : null}
                </View>
                <AppText variant="caption" tone="muted" align="center" style={local.terms}>
                  {i18n.t("checkout.terms")}
                </AppText>
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Presentation-only TransactionBar: the total is the owner's
          cart.total; readiness and submission stay owned by this screen. */}
      {hasItems ? (
        <View
          style={local.actionBar}
          onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
        >
          <TransactionBar
            totalLabel={i18n.t("checkout.total")}
            totalValue={formatMoney(cart.total, cart.currency)}
            countLabel={i18n.plural("transaction.ticketCount", ticketSlots.length)}
            accessory={
              blockerMessage ? (
                <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
                  {blockerMessage}
                </AppText>
              ) : null
            }
            primaryAction={{
              label: payLabel,
              onPress: handleContinue,
              disabled: !canContinue,
              busy: loading,
              accessibilityHint: blockerMessage ?? i18n.t("checkout.pay.hint"),
            }}
          />
        </View>
      ) : null}

      {loading ? (
        <View
          style={[local.overlay, { backgroundColor: theme.colors.scrim }]}
          accessibilityViewIsModal
          aria-busy
        >
          <View
            style={[local.overlayPanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${i18n.t("checkout.blue.preparing.title")}. ${i18n.t("checkout.blue.preparing.message")}`}
          >
            <ActivityIndicator color={theme.colors.actionPrimary} />
            <AppText variant="cardTitle" align="center">{i18n.t("checkout.blue.preparing.title")}</AppText>
            <AppText variant="meta" tone="muted" align="center">{i18n.t("checkout.blue.preparing.message")}</AppText>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  scroll: { width: "100%" as const },
  content: { width: "100%" as const, gap: spacing.lg },
  layout: { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const, gap: spacing.lg },
  layoutWide: {
    maxWidth: 1080,
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
  },
  column: { gap: spacing.lg },
  mainColumn: { flex: 1, minWidth: 0 },
  sideColumn: { width: 380 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  inlineStatus: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  terms: { paddingHorizontal: spacing.lg },
  actionBar: { position: "absolute" as const, left: 0, right: 0, bottom: 0 },
  overlay: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: spacing.xxl,
  },
  overlayPanel: {
    width: "100%" as const,
    maxWidth: 320,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
};

export default withAuthRequired(CheckoutScreen);
