import { translate } from "@/i18n/runtime";
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
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useCart } from "@/context/CartContext";
import { useTicketHolders } from "@/context/TicketHoldersContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { errorFacts } from "@/lib/apiErrorFacts";
import {
  clearBluePaymentHandoff,
  clearPendingBluePaymentAttempt,
  createBluePaymentHandoff,
  readPendingBluePaymentAttempt,
  savePendingBluePaymentAttempt,
} from "@/lib/bluePaymentHandoff";
import { freeSubmitCompletion } from "@/lib/cardPaymentResult";
import {
  checkoutResultRouteParams,
  parseCheckoutResultParams,
  singlePurchasedMatchId,
} from "@/lib/checkoutResultParams";
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
  findCardPaymentRetry,
} from "@/lib/cardPaymentHandoff";
import { isAuthenticationSnapshotCurrent } from "@/services/api";
import { groupCartItems } from "@/lib/cartDisplay";
import { isFreeCartTotal } from "@/lib/cartTotal";
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
  prepareNewPaymentAfterUnknown,
  readPaymentAttempt,
  readPaymentOutcomeLock,
  selectPaymentAccount,
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
import { PAYMENT_RECOVERY_TICKETS_ROUTE } from "@/lib/paymentRecoveryTickets";
import { getUserScopedCacheGeneration } from "@/lib/userScopedCache";
import { paymentError, reasonWithGuidance, userFacingError } from "@/lib/userFacingError";
import { checkoutService } from "@/services/checkout";
import type { CheckoutSubmitRequest } from "@/types";
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
  return config.apiOrigin;
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
  const alert = useAlertDialog();
  const [newPaymentRequest] = useState(createRequestAuthority);
  const confirmingNewPaymentRef = useRef(false);
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
  // Session whose payment has an unknown outcome (see paymentOutcomeLock):
  // a lock that blocks every method on it (read with the BLUE view, which
  // ignores an account-scope card marker). Mirrored into state so the screen
  // re-renders; the lock itself is module state and survives leaving this
  // screen.
  const [paymentLockSession, setPaymentLockSession] = useState<string | null>(
    () => readPaymentOutcomeLock(cart.sessionId, null, "blue")?.sessionId ?? null,
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
  // A confirmed free order is clearing its cart: the empty-cart redirect
  // must not race the success navigation.
  const freeOrderCompletingRef = useRef(false);
  const accountId = auth.user ? String(auth.user.id) : null;
  const name = auth.user?.name.trim() ?? "";
  const email = auth.user?.email?.trim() ?? "";
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
  // Case 1: the backend cart total is exactly 0. No method is chosen; the
  // order is submitted with payment_method "free". A mixed cart (total > 0)
  // pays normally and the backend issues its free tickets with the order.
  const isFreeCart = isFreeCartTotal(cart.total, cart.items.length);
  const effectiveMethod: CheckoutSubmitRequest["payment_method"] | null = isFreeCart ? "free" : paymentMethod;
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
      setPaymentLockSession(readPaymentOutcomeLock(cart.sessionId, null, "blue")?.sessionId ?? null);
      setGateVersion((version) => version + 1);
      void refreshUser().catch(() => {});
      // Retries a failed read of this account's unresolved card results
      // (a no-op once read). Never called with null: that is the owner's call.
      if (accountId !== null) {
        void selectPaymentAccount(accountId).then(() => {
          setPaymentLockSession(readPaymentOutcomeLock(cart.sessionId, null, "blue")?.sessionId ?? null);
          setGateVersion((version) => version + 1);
        });
      }
    }, [accountId, cart.sessionId, refreshUser]),
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
    // A confirmed free order clears its own cart and opens the success screen.
    if (freeOrderCompletingRef.current) return;
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
            translate("checkout.prepareFailed"),
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
    if (!shouldInitializeCaptureContext(effectiveMethod ?? "", sessionId)) return;

    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadCaptureContext(sessionId).catch(() => {});
    });
    return () => {
      active = false;
    };
  }, [cart.sessionId, effectiveMethod, loadCaptureContext]);

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
    newPaymentRequest.mount();
    return () => {
      captureRequestAuthority.unmount();
      checkoutSubmissionAuthority.unmount();
      newPaymentRequest.unmount();
      captureSessionRef.current = null;
      captureRetrySessionRef.current = null;
      capturePromiseRef.current = null;
    };
  }, [captureRequestAuthority, checkoutSubmissionAuthority, newPaymentRequest]);

  /**
   * Zero-total order (case 1): `/checkout/mobile/submit` with
   * `payment_method: "free"`. No provider and no payment payload. It holds
   * the session's one payment attempt like BLUE and card, so it can never
   * run beside another payment or be sent twice. The cart is cleared only
   * after a response that proves the order (`freeSubmitCompletion`) for the
   * same cart session. An unproven 2xx or an unknown failure may have
   * created the order, so the session is locked (check My Tickets); a
   * definite rejection releases the attempt.
   */
  const submitFree = async () => {
    if (!cart.sessionId || submitInFlightRef.current || blueHandoffStartedRef.current) return;

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

    const billing = createCheckoutBilling(name, email, canonicalPhone);
    if (!billing) {
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
    const sessionId = submissionTicket.sessionId;
    let attempt: PaymentAttempt | null = null;
    try {
      submitInFlightRef.current = true;
      setLoading(true);

      const ticketsByMatch = buildTicketsByMatch(ticketSlots, holderNames);

      const acquisition = await acquirePaymentAttempt(sessionId, "free");
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
      const owner = cart.readCartGuardState();
      const blocker = paymentSubmitBlocker({
        sessionId,
        owner: {
          ...owner,
          paymentOutcomeUnknown: readPaymentOutcomeLock(sessionId, null, "free") !== null,
          paymentAttemptInProgress: isPaymentAttemptHeldByOther(sessionId, attempt),
        },
      });
      if (blocker || !cart.isCartSessionCurrent(cartSessionTicket)) {
        await settlePaymentAttempt(sessionId, attempt.id);
        return;
      }

      const response = await checkoutService.submit({
        checkout_session_id: sessionId,
        billing,
        tickets_by_match: ticketsByMatch,
        payment_method: "free",
      });

      if (freeSubmitCompletion(response) !== "complete") {
        // A 2xx that does not prove the order: it may exist. Never resubmit.
        if (cart.isCartSessionCurrent(cartSessionTicket)) markPaymentOutcomeUnknown(sessionId, "free");
        if (checkoutSubmissionAuthority.isCurrent(submissionTicket) && cart.isCartSessionCurrent(cartSessionTicket)) {
          setPaymentLockSession(sessionId);
          toast.showToast({
            variant: "error",
            title: i18n.t("checkout.submitFailed.title"),
            message: i18n.t("checkout.free.unconfirmed"),
            duration: 6200,
          });
        }
        return;
      }

      if (!cart.isCartSessionCurrent(cartSessionTicket)) return;
      if (!checkoutSubmissionAuthority.isCurrent(submissionTicket)) {
        // Confirmed, but this screen is gone and cannot reconcile the cart:
        // the session is never submitted again (as the card screen does).
        markPaymentOutcomeUnknown(sessionId, "free");
        return;
      }

      const resultParams = checkoutResultRouteParams(
        parseCheckoutResultParams({
          provider: "free",
          // Display-only: which match's tickets "View my ticket" opens.
          match_id: singlePurchasedMatchId(ticketsByMatch),
          order_id: response.order_id,
          order_number: response.order_number,
          reference: response.reference,
          status: response.status,
        }),
      );
      freeOrderCompletingRef.current = true;
      const cleared = await cart.clearCartIfSession(cartSessionTicket);
      // The clear awaits storage: Checkout may have unmounted or started
      // another submission meanwhile. Only the live submission navigates.
      if (!cleared || !checkoutSubmissionAuthority.isCurrent(submissionTicket)) {
        freeOrderCompletingRef.current = false;
        return;
      }
      const resetRouter = router as typeof router & { dismissAll?: () => void };
      resetRouter.dismissAll?.();
      router.replace({ pathname: "/checkout/success", params: resultParams });
    } catch (err) {
      const failure = paymentFailureKind(errorFacts(err));
      // Decided for the attempt's own session even if this screen is gone.
      if (cart.isCartSessionCurrent(cartSessionTicket)) {
        if (failure === "unknown") markPaymentOutcomeUnknown(sessionId, "free");
        else if (attempt) void settlePaymentAttempt(sessionId, attempt.id);
      }
      if (
        checkoutSubmissionAuthority.isCurrent(submissionTicket) &&
        cart.isCartSessionCurrent(cartSessionTicket)
      ) {
        if (failure === "unknown") setPaymentLockSession(sessionId);
        toast.showToast({
          variant: "error",
          title: i18n.t("checkout.submitFailed.title"),
          message:
            failure === "unknown"
              ? reasonWithGuidance(err, i18n.t("checkout.free.unconfirmed"))
              : userFacingError(
                  err,
                  failure === "notCompleted"
                    ? i18n.t("checkout.submitFailed.notCompleted")
                    : failure === "session"
                      ? i18n.t("payment.failed.session")
                      : i18n.t("ticketError.maintenance"),
                ),
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
          paymentOutcomeUnknown: readPaymentOutcomeLock(submissionTicket.sessionId, null, "blue") !== null,
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
        // The backend's reason when it gave one. An unknown outcome (network,
        // timeout, server error) may have created the order, so it keeps its
        // guidance and never reads as a plain failure.
        if (failure === "unknown") {
          // No trustworthy answer: the order may exist. Block paying again
          // for this session (backend idempotency is not established).
          setPaymentLockSession(submissionTicket.sessionId);
        }
        toast.showToast({
          variant: "error",
          title: i18n.t("checkout.submitFailed.title"),
          message:
            failure === "unknown"
              ? reasonWithGuidance(err, i18n.t("checkout.submitFailed.unknown"))
              : userFacingError(
                  err,
                  failure === "notCompleted"
                    ? i18n.t("checkout.submitFailed.notCompleted")
                    : failure === "session"
                      ? i18n.t("payment.failed.session")
                      : i18n.t("ticketError.maintenance"),
                ),
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
  const sessionPaymentUnknown = paymentLockSession !== null && paymentLockSession === cart.sessionId;
  // An unresolved card result from another session (or unreadable markers):
  // new card payments are paused for the account; BLUE stays available.
  // gateVersion keeps the module read fresh (focus, marker load).
  const cardPausedForAccount = gateVersion >= 0 && !sessionPaymentUnknown
    && readPaymentOutcomeLock(cart.sessionId)?.scope === "account";
  const paymentOutcomeUnknown = sessionPaymentUnknown || (effectiveMethod === "cybersource" && cardPausedForAccount);
  // This session existed before the app started and the device's record of
  // earlier card results cannot be read: a card result for it cannot be ruled
  // out, so it is blocked for every method until a retried read succeeds.
  const sessionRecordUnreadable = gateVersion >= 0 && sessionPaymentUnknown
    && readPaymentOutcomeLock(cart.sessionId, null, "blue")?.reason === "unreadable";
  const [recheckingRecord, setRecheckingRecord] = useState(false);
  const recheckPaymentRecord = () => {
    if (accountId === null || recheckingRecord) return;
    setRecheckingRecord(true);
    void selectPaymentAccount(accountId).finally(() => {
      setRecheckingRecord(false);
      setPaymentLockSession(readPaymentOutcomeLock(cart.sessionId, null, "blue")?.sessionId ?? null);
      setGateVersion((version) => version + 1);
    });
  };
  const confirmNewPayment = async () => {
    if (confirmingNewPaymentRef.current || accountId === null) return;
    const cartTicket = cart.captureCartSession();
    if (!cartTicket?.sessionId) return;
    const sessionId = cartTicket.sessionId;
    const request = newPaymentRequest.begin(sessionId);
    const generation = getUserScopedCacheGeneration();
    const current = () => newPaymentRequest.isCurrent(request)
      && generation === getUserScopedCacheGeneration() && cart.isCartSessionCurrent(cartTicket)
      && !submitInFlightRef.current && !blueHandoffStartedRef.current;
    const allowNewPayment = prepareNewPaymentAfterUnknown(sessionId, accountId, current);
    if (!allowNewPayment) {
      toast.showToast({ variant: "error", message: i18n.t("checkout.paymentUnknown.payAgainError") });
      return;
    }
    confirmingNewPaymentRef.current = true;
    try {
      const accepted = await alert.showAlert({
        variant: "confirm",
        title: i18n.t("checkout.paymentUnknown.payAgainTitle"),
        message: i18n.t("checkout.paymentUnknown.payAgainMessage"),
        confirmLabel: i18n.t("checkout.paymentUnknown.payAgain"),
      });
      if (!accepted || !current()) return;
      const publication = await cart.refreshCart();
      if (!current()) return;
      if (!publication.confirmed || publication.snapshot.sessionId !== sessionId || publication.snapshot.items.length === 0 || !(await allowNewPayment())) {
        toast.showToast({ variant: "error", message: i18n.t("checkout.paymentUnknown.payAgainError") });
        return;
      }
      if (!current()) return;
      clearPendingBluePaymentAttempt(sessionId);
      captureRequestAuthority.invalidate(sessionId);
      captureSessionRef.current = null;
      captureRetrySessionRef.current = null;
      capturePromiseRef.current = null;
      setCaptureState(null);
      setPaymentLockSession(readPaymentOutcomeLock(sessionId, null, "blue")?.sessionId ?? null);
      setGateVersion((version) => version + 1);
      if (paymentMethod === "cybersource") void loadCaptureContext(sessionId, true).catch(() => {});
    } catch {
      if (current()) toast.showToast({ variant: "error", message: i18n.t("checkout.paymentUnknown.payAgainError") });
    } finally {
      confirmingNewPaymentRef.current = false;
    }
  };
  const currentCardRetry = () => findCardPaymentRetry(
    cart.sessionId,
    accountId,
    (snapshot, ticket, attempt) => isAuthenticationSnapshotCurrent(snapshot)
      && cart.isCartSessionCurrent(ticket)
      && readPaymentAttempt(cart.sessionId)?.id === attempt.id,
  );
  // A returning checkout re-reads the handoff when its focus gate changes.
  // Not gated on the client timer: the held result was never sent, the cart
  // owner keeps the session while it is held, and the backend decides whether
  // the reservation is still valid.
  const cardRetryHandoffId = gateVersion >= 0 ? currentCardRetry() : null;
  const openCardRetry = () => {
    const handoff = currentCardRetry();
    const owner = cart.readCartGuardState();
    if (handoff && !owner.reconciliationRequired && owner.itemCount > 0) {
      router.navigate({ pathname: "/checkout/card/payment", params: { handoff } });
    }
  };
  // The shared session gate, read from its owner (re-read on focus via gateVersion).
  const attemptBlocksCheckout = (sessionId: string | null) =>
    checkoutAttemptBlocks({
      heldMethod: readPaymentAttempt(sessionId)?.method ?? null,
      paymentMethod: effectiveMethod,
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
    paymentMethod: effectiveMethod,
    profileComplete: !!name,
    phoneValid: !!canonicalPhone,
  });
  const canContinue = readiness.ready;

  const handleContinue = () => {
    if (!canContinue) return;
    // Re-validate at the moment of the press against the owner's current
    // state (not the last render): a cart that changed, expired, became
    // unconfirmed or has an unknown payment can never start a handoff.
    const ownerState = cart.readCartGuardState();
    // Method-aware: an account-scope card marker blocks only card.
    const lock = readPaymentOutcomeLock(
      ownerState.sessionId,
      null,
      effectiveMethod === "blue" ? "blue" : effectiveMethod === "free" ? "free" : "card",
    );
    const guard = submissionGuard({
      renderedSessionId: cart.sessionId,
      owner: {
        ...ownerState,
        paymentOutcomeUnknown: lock !== null,
        paymentAttemptInProgress: attemptBlocksCheckout(ownerState.sessionId),
      },
      inFlight: submitInFlightRef.current || blueHandoffStartedRef.current || isCheckoutLocked,
      holdersComplete: holderCompleteness(ticketSlots, holderNames).allComplete,
      paymentMethod: effectiveMethod,
      profileComplete: !!name,
      phoneValid: !!canonicalPhone,
    });
    if (!guard.ok) {
      if (lock && lock.scope !== "account") setPaymentLockSession(lock.sessionId);
      else if (lock) setGateVersion((version) => version + 1);
      if (guard.blocker && guard.blocker !== "busy") {
        toast.showToast({
          variant: "warning",
          title: i18n.t("checkout.submitBlocked.title"),
          message: i18n.t(`checkout.blocker.${guard.blocker}`),
        });
      }
      return;
    }
    if (effectiveMethod === "free") {
      void submitFree();
      return;
    }
    if (effectiveMethod === "cybersource") {
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
        accountId,
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
    effectiveMethod === "free"
      ? i18n.t("checkout.pay.free")
      : effectiveMethod === "cybersource"
      ? i18n.t("checkout.pay.card", { total: formatMoney(cart.total, cart.currency) })
      : paymentMethod === "blue"
        ? i18n.t("checkout.pay.blue")
        : i18n.t("checkout.pay.choose");
  const payNote =
    effectiveMethod === "free"
      ? i18n.t("checkout.pay.freeNote")
      : effectiveMethod === "cybersource"
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
    { label: i18n.t("checkout.billing.name"), value: name, isLTR: false },
    // Email is optional, so a phone-only account shows no Email row rather than a missing value.
    ...(email ? [{ label: i18n.t("checkout.billing.email"), value: email, isLTR: true }] : []),
    { label: i18n.t("checkout.billing.phone"), value: canonicalPhone, isLTR: true },
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
          // v3 checkout: iOS shows no header title (the in-page heading is it); Android does.
          titleOnIos={false}
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
              {cardRetryHandoffId && !reconciliationRequired ? (
                <StatePanel
                  variant="info"
                  title={i18n.t("payment.card.unresolved.title")}
                  message={i18n.t("payment.card.unresolved.retryMessage")}
                  action={{ label: i18n.t("payment.card.unresolved.retrySubmit"), onPress: openCardRetry }}
                />
              ) : sessionRecordUnreadable && !cardRetryHandoffId ? (
                <StatePanel
                  variant="info"
                  title={i18n.t("checkout.paymentUnknown.title")}
                  message={i18n.t("checkout.paymentUnknown.unreadableMessage")}
                  action={{ label: i18n.t("common.retry"), onPress: recheckPaymentRecord }}
                  secondaryAction={{ label: i18n.t("payment.viewTickets"), onPress: () => router.replace(PAYMENT_RECOVERY_TICKETS_ROUTE) }}
                />
              ) : sessionPaymentUnknown && !cardRetryHandoffId ? (
                <StatePanel
                  variant="info"
                  title={i18n.t("checkout.paymentUnknown.title")}
                  message={i18n.t("checkout.paymentUnknown.message")}
                  action={{ label: i18n.t("payment.viewTickets"), onPress: () => router.replace(PAYMENT_RECOVERY_TICKETS_ROUTE) }}
                  secondaryAction={{ label: i18n.t("checkout.paymentUnknown.payAgain"), onPress: () => { void confirmNewPayment(); } }}
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
              ) : cardPausedForAccount && !cardRetryHandoffId && !isFreeCart ? (
                // Card only: BLUE stays available (the copy says so).
                <StatePanel
                  variant="info"
                  title={i18n.t("checkout.paymentUnknown.title")}
                  message={i18n.t("checkout.paymentUnknown.accountMessage")}
                  action={{ label: i18n.t("payment.viewTickets"), onPress: () => router.replace(PAYMENT_RECOVERY_TICKETS_ROUTE) }}
                  secondaryAction={{ label: i18n.t("checkout.paymentUnknown.payAgain"), onPress: () => { void confirmNewPayment(); } }}
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
                        style={[local.billingValue, row.value && row.isLTR ? { writingDirection: "ltr" } : null]}
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
                {isFreeCart ? (
                  // Zero total: nothing to choose; the order is submitted as "free".
                  <StatePanel
                    variant="info"
                    title={i18n.t("checkout.free.title")}
                    message={i18n.t("checkout.free.message")}
                  />
                ) : (
                  <>
                <AppText variant="overline" tone="muted" accessibilityRole="header">{i18n.t("checkout.payment.title")}</AppText>
                <PaymentMethodOptions
                  selected={paymentMethod}
                  disabled={isCheckoutLocked || cardRetryHandoffId !== null}
                  onSelect={setPaymentMethod}
                  status={{
                    cybersource: captureError ? (
                      <CartNotice
                        tone="danger"
                        message={captureError}
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
                  </>
                )}
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
      {hasItems && !cardRetryHandoffId ? (
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
              icon: effectiveMethod && effectiveMethod !== "free" ? (
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
            accessibilityLabel={`${i18n.t(isFreeCart ? "checkout.free.confirming.title" : "checkout.blue.preparing.title")}. ${i18n.t("checkout.blue.preparing.message")}`}
          >
            <ActivityIndicator color={theme.colors.actionPrimary} />
            <AppText variant="bodyStrong" align="center">{i18n.t(isFreeCart ? "checkout.free.confirming.title" : "checkout.blue.preparing.title")}</AppText>
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
