import { FlowHeader, StepBar } from "@/components/FlowHeader";
import { CartNotice } from "@/components/cart/CartNotice";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { useReservationAnnouncements } from "@/components/cart/ReservationStatus";
import { PaymentMethodOptions } from "@/components/checkout/PaymentMethodOptions";
import { AppText, StatePanel, TransactionBar } from "@/components/foundation";
import type { PaymentMethodOption } from "@/components/PaymentMethodSheet";
import { TicketHoldersBlock } from "@/components/TicketHoldersBlock";
import { useResponsive, useTheme } from "@/components/ui";
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
import { singlePurchasedMatchId } from "@/lib/checkoutResultParams";
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
  checkoutBackBlocked,
  checkoutBackHandlers,
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
import { layout, radius, size, spacing } from "@/lib/designTokens";
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
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const insets = useSafeAreaInsets();
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
  // Header and hardware Back share one policy: never leave while a submit is
  // in flight or a payment handoff has started (the existing synchronous
  // guards; no new lock). Normal Back resumes as soon as they clear.
  const isBackBlocked = useCallback(
    () => checkoutBackBlocked({ submitInFlight: submitInFlightRef.current, handoffStarted: blueHandoffStartedRef.current }),
    [],
  );
  const leaveToCart = useCallback(() => router.replace("/cart"), []);
  // Handlers are built at press time (refs are read only inside events).
  const onHeaderBack = useCallback(() => checkoutBackHandlers(isBackBlocked, leaveToCart).header(), [isBackBlocked, leaveToCart]);
  const onHardwareBack = useCallback(() => checkoutBackHandlers(isBackBlocked, leaveToCart).hardware(), [isBackBlocked, leaveToCart]);
  // The visible countdown is the global read-only indicator; this keeps the
  // thresholded screen-reader warnings on Checkout.
  useReservationAnnouncements(cart.secondsLeft);

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
    (paymentUrl: string, sessionId: string, purchasedMatchId: string | null = null) => {
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

      const handoffId = createBluePaymentHandoff(paymentUrl, sessionId, purchasedMatchId);
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
      onHardwareBack,
    );
    return () => subscription.remove();
  }, [onHardwareBack]);

  useEffect(() => {
    // After expiry the owner has already routed Home under its sheet.
    if (isFocused && !cart.isLoading && !cart.sessionId && !cart.items.length && !cart.expiredHold)
      router.replace("/cart");
  }, [cart.expiredHold, cart.isLoading, cart.items.length, cart.sessionId, isFocused]);

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
      // Continuing the BLUE request reopens its own stored URL; nothing is
      // submitted, so no second BLUE order is created. A parked attempt
      // (the BLUE page was left) is re-held first, so another method waits
      // while the BLUE page is open again. A running card attempt blocks it.
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
          // The match this BLUE order was submitted for, kept with the order.
          reusableAttempt.purchasedMatchId ?? null,
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

      const purchasedMatchId = singlePurchasedMatchId(ticketsByMatch);
      savePendingBluePaymentAttempt({
        sessionId: submissionTicket.sessionId,
        paymentUrl: validatedUrl,
        purchasedMatchId,
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

      launchBluePayment(validatedUrl, submissionTicket.sessionId, purchasedMatchId);
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
      ? i18n.t("checkout.pay.card", { total: formatMoney(cart.total, cart.currency) })
      : paymentMethod === "blue"
        ? i18n.t("checkout.pay.blue")
        : i18n.t("checkout.pay.choose");
  const payNote =
    paymentMethod === "cybersource"
      ? i18n.t("checkout.pay.cardNote")
      : paymentMethod === "blue"
        ? i18n.t("checkout.pay.blueNote")
        : undefined;
  const blockerMessage =
    readiness.blocker && readiness.blocker !== "busy"
      ? i18n.t(`checkout.blocker.${readiness.blocker}`)
      : null;
  const hasItems = cart.items.length > 0;
  const billingRows = [
    { label: i18n.t("checkout.billing.name"), value: name },
    { label: i18n.t("checkout.billing.email"), value: email },
    { label: i18n.t("checkout.billing.phone"), value: canonicalPhone },
  ];

  return (
    <View style={[local.root, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ gestureEnabled: false, headerShown: false }} />
      <View style={[local.header, { paddingTop: insets.top }]}>
        <FlowHeader
          title={i18n.t("checkout.title")}
          backLabel={i18n.t("flow.cart")}
          onBack={onHeaderBack}
          backDisabled={loading}
        />
      </View>
      <ScrollView
        style={local.scroll}
        contentContainerStyle={[
          local.content,
          { paddingBottom: hasItems ? barHeight + spacing.lg : spacing.xxxl },
        ]}
      >
        {!hasItems ? (
          <View style={[local.layout, { width: responsive.contentWidth }]}>
            <StatePanel
              variant="empty"
              title={i18n.t("checkout.empty.title")}
              message={i18n.t("checkout.empty.message")}
            />
          </View>
        ) : (
          <View style={[local.layout, { width: responsive.contentWidth }, twoColumn && local.layoutWide]}>
            <View style={[local.column, twoColumn && local.mainColumn]}>
              <StepBar step={2} />
              <AppText variant="displayPrompt" accessibilityRole="header">{i18n.t("checkout.prompt")}</AppText>
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

              <View style={local.section}>
                <AppText variant="overline" tone="muted" accessibilityRole="header">{i18n.t("checkout.billing.title")}</AppText>
                {/* Read-only profile values; the backend receives the same billing it always has. */}
                <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
                  {billingRows.map((row, index) => (
                    <View
                      key={row.label}
                      style={[local.billingRow, index > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}
                      accessible
                      accessibilityLabel={`${row.label}: ${row.value || i18n.t("checkout.billing.missing")}`}
                    >
                      <AppText variant="body" tone="muted">{row.label}</AppText>
                      <AppText
                        variant="body"
                        tone={row.value ? "strong" : "danger"}
                        numberOfLines={1}
                        style={local.billingValue}
                      >
                        {row.value || i18n.t("checkout.billing.missing")}
                      </AppText>
                    </View>
                  ))}
                </View>
                {auth.isRefreshingUser ? (
                  <AppText variant="meta" tone="muted" accessibilityLiveRegion="polite">
                    {i18n.t("checkout.profile.loading")}
                  </AppText>
                ) : null}
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
              <View style={local.section}>
                <AppText variant="overline" tone="muted" accessibilityRole="header">{i18n.t("checkout.payment.title")}</AppText>
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
              </View>
              <AppText variant="caption" tone="muted" align="center" style={local.terms}>
                {i18n.t("checkout.terms")}
              </AppText>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Presentation-only TransactionBar: the total is the owner's
          cart.total; readiness and submission stay owned by this screen.
          Choosing a method above never pays — only this explicit action does. */}
      {hasItems ? (
        <View
          style={local.actionBar}
          onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
        >
          <TransactionBar
            stacked
            accessory={
              blockerMessage ? (
                <AppText variant="caption" tone="muted" align="center" accessibilityLiveRegion="polite">
                  {blockerMessage}
                </AppText>
              ) : null
            }
            note={payNote}
            primaryAction={{
              label: payLabel,
              onPress: handleContinue,
              disabled: !canContinue,
              busy: loading,
              accessibilityHint: blockerMessage ?? i18n.t("checkout.pay.hint"),
              icon: paymentMethod ? (
                <SymbolView
                  name={{ ios: "lock.fill", android: "lock", web: "lock" }}
                  size={16}
                  tintColor={canContinue ? theme.colors.onActionPrimary : theme.colors.disabledText}
                  fallback={<View />}
                />
              ) : undefined,
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
            style={[local.overlayPanel, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowRaised }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${i18n.t("checkout.blue.preparing.title")}. ${i18n.t("checkout.blue.preparing.message")}`}
          >
            <ActivityIndicator color={theme.colors.actionPrimary} />
            <AppText variant="bodyStrong" align="center">{i18n.t("checkout.blue.preparing.title")}</AppText>
            <AppText variant="meta" tone="muted" align="center">{i18n.t("checkout.blue.preparing.message")}</AppText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const local = {
  root: { flex: 1 },
  header: { width: "100%" as const, paddingHorizontal: layout.gutter },
  scroll: { width: "100%" as const },
  content: { width: "100%" as const, gap: spacing.lg, paddingTop: spacing.sm },
  layout: { maxWidth: 720, alignSelf: "center" as const, gap: spacing.xl },
  layoutWide: {
    maxWidth: 1080,
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
  },
  column: { gap: spacing.xl },
  mainColumn: { flex: 1, minWidth: 0 },
  sideColumn: { width: 380 },
  section: { gap: spacing.sm },
  card: { borderRadius: radius.xl, overflow: "hidden" as const },
  billingRow: {
    minHeight: size.touchTarget,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  billingValue: { flexShrink: 1, fontWeight: "500" as const },
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
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
};

export default withAuthRequired(CheckoutScreen);
