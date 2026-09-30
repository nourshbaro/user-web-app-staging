import { AppHeader } from "@/components/AppHeader";
import { CybersourceUnifiedCheckout } from "@/components/CybersourceUnifiedCheckout";
import { PaymentOutcomePanel, UnknownOutcomeSteps } from "@/components/checkout/PaymentOutcome";
import { AppText, StatePanel } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { errorFacts } from "@/lib/apiErrorFacts";
import {
  clearCardPaymentHandoff,
  readCardPaymentHandoff,
} from "@/lib/cardPaymentHandoff";
import { canLeavePayment, paymentFailureKind, paymentSubmitBlocker, type PaymentFailureKind } from "@/lib/checkoutFlow";
import {
  checkoutResultRouteParams,
  parseCheckoutResultParams,
} from "@/lib/checkoutResultParams";
import { spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import {
  acquirePaymentAttempt,
  isPaymentAttemptHeldByOther,
  markPaymentOutcomeUnknown,
  readPaymentOutcomeLock,
  settlePaymentAttempt,
  type PaymentAttempt,
} from "@/lib/paymentOutcomeLock";
import { checkoutService } from "@/services/checkout";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type CardFailure =
  | { kind: "unavailable" }
  /** The shared cart gate is active: the cart must be re-read before paying. */
  | { kind: "reconcile" }
  /** A payment for this session has an unknown outcome: paying again is blocked. */
  | { kind: "locked" }
  /** The reservation expired while the card form was open: nothing was sent. */
  | { kind: "expired" }
  /** The attempt could not be recorded before submitting: nothing was sent. */
  | { kind: "notStarted" }
  /** Another payment attempt (e.g. BLUE) holds this session: nothing was sent. */
  | { kind: "inProgress" }
  | { kind: PaymentFailureKind };

function failureMessage(i18n: ReturnType<typeof useI18n>, kind: CardFailure["kind"]) {
  switch (kind) {
    case "unavailable":
      return i18n.t("payment.card.sessionGone");
    case "expired":
      return i18n.t("payment.reservationGone");
    case "notStarted":
      return i18n.t("payment.notStarted");
    case "inProgress":
      return i18n.t("checkout.blocker.attemptInProgress");
    case "reconcile":
      return i18n.t("checkout.reconcile.message");
    case "locked":
      return i18n.t("checkout.paymentUnknown.message");
    case "notCompleted":
      return i18n.t("payment.failed.notCompleted");
    case "session":
      return i18n.t("payment.failed.session");
    case "maintenance":
      return i18n.t("ticketError.maintenance");
    default:
      return i18n.t("payment.failed.unknown");
  }
}

/**
 * Card payment. CyberSource Unified Checkout collects the card and yields a
 * transient token; this screen submits it once to `/checkout/mobile/submit`.
 * Only a successful response for the still-current cart session clears the
 * cart (`clearCartIfSession`) and opens the success screen. Nothing here
 * infers success from client state; a failure whose outcome is unknown
 * (network, timeout, server error) is never presented as "not charged".
 */
export function CardPaymentScreen() {
  const theme = useTheme();
  const cart = useCart();
  const toast = useToast();
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ handoff?: string | string[] }>();
  const handoffId = firstParam(params.handoff) ?? "";
  const [handoff] = useState(() => readCardPaymentHandoff(handoffId));
  const submittingRef = useRef(false);
  const activeRef = useRef(true);
  const [captureContext, setCaptureContext] = useState<string | null>(
    handoff?.captureContext ?? null,
  );
  const [preparationError, setPreparationError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [failure, setFailure] = useState<CardFailure | null>(() =>
    !handoff
      ? { kind: "unavailable" }
      : readPaymentOutcomeLock(handoff.sessionId)
        ? { kind: "locked" }
        : isPaymentAttemptHeldByOther(handoff.sessionId, null)
          ? { kind: "inProgress" }
          : null,
  );

  const returnToCheckout = useCallback(() => {
    clearCardPaymentHandoff(handoffId);
    router.dismissTo("/checkout");
  }, [handoffId]);

  useEffect(() => {
    activeRef.current = true;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        // A submitted payment is in flight: leaving now could hide its result.
        if (canLeavePayment(submittingRef)) returnToCheckout();
        return true;
      },
    );
    return () => {
      activeRef.current = false;
      subscription.remove();
      clearCardPaymentHandoff(handoffId);
    };
  }, [handoffId, returnToCheckout]);

  const preparePayment = useCallback(async (force = false) => {
    if (!handoff || cart.sessionId !== handoff.sessionId) return;
    setPreparationError(false);
    try {
      const context = await handoff.prepareCaptureContext(force);
      if (activeRef.current && cart.sessionId === handoff.sessionId) setCaptureContext(context);
    } catch {
      if (activeRef.current && cart.sessionId === handoff.sessionId) {
        setPreparationError(true);
      }
    }
  }, [cart.sessionId, handoff]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && !captureContext && !preparationError) void preparePayment();
    });
    return () => {
      active = false;
    };
  }, [captureContext, preparationError, preparePayment]);

  // Current owner state, not the last render: a changed, expired or
  // unconfirmed cart, an unknown earlier payment for this session, or another
  // attempt holding it, never submits. Run before the attempt is acquired
  // (own = null) and again right before the submit (own = this attempt).
  const submitBlock = useCallback((sessionId: string, own: PaymentAttempt | null): CardFailure | null => {
    const owner = cart.readCartGuardState();
    const blocker = paymentSubmitBlocker({
      sessionId,
      owner: {
        ...owner,
        paymentOutcomeUnknown: readPaymentOutcomeLock(sessionId) !== null,
        paymentAttemptInProgress: isPaymentAttemptHeldByOther(sessionId, own),
      },
    });
    return blocker === null ? null : { kind: blocker === "changed" ? "unavailable" : blocker };
  }, [cart]);

  const handleSuccess = useCallback(
    async (transientToken: string) => {
      if (
        !handoff ||
        submittingRef.current ||
        cart.sessionId !== handoff.sessionId
      )
        return;
      const cartTicket = cart.captureCartSession();
      if (!cartTicket || cartTicket.sessionId !== handoff.sessionId) return;
      const sessionId = handoff.sessionId;
      const blockedAtToken = submitBlock(sessionId, null);
      if (blockedAtToken) {
        setFailure(blockedAtToken);
        return;
      }
      submittingRef.current = true;
      setFailure(null);
      setProcessing(true);
      let attempt: PaymentAttempt | null = null;
      try {
        // Acquire the session's one payment attempt (shared with BLUE) and
        // persist it before anything can reach the backend, so neither
        // another surface nor a process restart can start a second payment.
        const acquisition = await acquirePaymentAttempt(sessionId, "card");
        if (!acquisition.ok) {
          if (activeRef.current) {
            setFailure(acquisition.reason === "blocked" ? submitBlock(sessionId, null) ?? { kind: "inProgress" } : { kind: "notStarted" });
          }
          return;
        }
        attempt = acquisition.attempt;
        // The reservation can expire (or change) while the card form is
        // open: re-check the owner immediately before the submit. This
        // attempt passes its own gate; nothing else would.
        const blockedBeforeSubmit = submitBlock(sessionId, attempt)
          ?? (cart.isCartSessionCurrent(cartTicket) ? null : { kind: "unavailable" as const });
        if (blockedBeforeSubmit) {
          await settlePaymentAttempt(sessionId, attempt.id);
          if (activeRef.current) setFailure(blockedBeforeSubmit);
          return;
        }
        const response = await checkoutService.submit({
          ...handoff.request,
          payment: { transient_token: transientToken },
        });
        if (!cart.isCartSessionCurrent(cartTicket)) return;
        if (!activeRef.current) {
          // Accepted for this session, but this screen is gone and cannot
          // reconcile it with the cart: never payable again (like BLUE's
          // unreconciled success). The cart is not cleared from here.
          markPaymentOutcomeUnknown(sessionId, "card");
          return;
        }
        const resultParams = checkoutResultRouteParams(
          parseCheckoutResultParams({
            provider: "cybersource",
            order_id: response.order_id,
            order_number: response.order_number,
            reference:
              response.reference ??
              response.payment_reference ??
              response.payment?.reference ??
              response.payment?.payment_reference,
            status: response.status ?? response.payment?.status,
          }),
        );
        const cleared = await cart.clearCartIfSession(cartTicket);
        if (!cleared || !activeRef.current) return;
        clearCardPaymentHandoff(handoffId);
        const resetRouter = router as typeof router & {
          dismissAll?: () => void;
        };
        resetRouter.dismissAll?.();
        router.replace({ pathname: "/checkout/success", params: resultParams });
      } catch (submissionError) {
        if (!cart.isCartSessionCurrent(cartTicket)) return;
        const kind = paymentFailureKind(errorFacts(submissionError));
        // The submit may have reached the backend: lock this session's payment.
        // Decided even if this screen is gone, so the lock is never skipped.
        if (kind === "unknown") markPaymentOutcomeUnknown(cartTicket.sessionId as string, "card");
        else if (attempt) void settlePaymentAttempt(sessionId, attempt.id);
        if (!activeRef.current) return;
        setFailure({ kind });
        toast.showToast({
          variant: "error",
          title: kind === "unknown" ? i18n.t("payment.unknown.title") : i18n.t("payment.failed.title"),
          message: failureMessage(i18n, kind),
        });
      } finally {
        submittingRef.current = false;
        if (activeRef.current) setProcessing(false);
      }
    },
    [cart, handoff, handoffId, i18n, submitBlock, toast],
  );

  const sessionMismatch = !handoff || cart.sessionId !== handoff.sessionId;

  return (
    <View
      style={[
        local.root,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: Math.max(insets.top, 14),
        },
      ]}
    >
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={local.header}>
        <AppHeader
          title={i18n.t("payment.card.title")}
          subtitle={i18n.t("payment.secure")}
          hideCart
          showTimer
          // The synchronous in-flight ref decides, so a press that lands before
          // the re-render still cannot leave and drop the payment's result.
          onBack={() => {
            if (canLeavePayment(submittingRef)) returnToCheckout();
          }}
          backDisabled={processing}
        />
        {!sessionMismatch && !failure ? (
          <View style={[local.amount, { borderColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
            <AppText variant="meta" tone="muted">{i18n.t("checkout.total")}</AppText>
            <AppText variant="numeric">{formatMoney(cart.total, cart.currency)}</AppText>
          </View>
        ) : null}
      </View>
      <View style={[local.paymentArea, { paddingBottom: insets.bottom }]}>
        {failure || sessionMismatch ? (
          <View style={local.messageArea}>
            <PaymentOutcomePanel
              variant={failure?.kind === "unknown" || failure?.kind === "locked" ? "unknown" : "failed"}
              title={
                failure?.kind === "unknown" || failure?.kind === "locked"
                  ? i18n.t("payment.unknown.title")
                  : failure?.kind === "reconcile"
                    ? i18n.t("cart.unconfirmed.title")
                    : failure && failure.kind !== "unavailable" && failure.kind !== "expired" && failure.kind !== "notStarted" && failure.kind !== "inProgress"
                      ? i18n.t("payment.failed.title")
                      : i18n.t("payment.unavailable.title")
              }
              message={failure ? failureMessage(i18n, failure.kind) : i18n.t("payment.reservationGone")}
              action={
                failure?.kind === "unknown" || failure?.kind === "locked"
                  ? { label: i18n.t("payment.viewTickets"), onPress: () => router.replace("/tickets") }
                  : { label: i18n.t("payment.back"), onPress: returnToCheckout }
              }
              secondaryAction={
                failure?.kind === "unknown" || failure?.kind === "locked"
                  ? { label: i18n.t("payment.back"), onPress: returnToCheckout }
                  : undefined
              }
            >
              {failure?.kind === "unknown" || failure?.kind === "locked" ? <UnknownOutcomeSteps /> : null}
            </PaymentOutcomePanel>
          </View>
        ) : captureContext ? (
          <View style={local.paymentArea}>
            <CybersourceUnifiedCheckout
              captureContext={captureContext}
              onSuccess={handleSuccess}
              onError={() => {}}
              fullscreen
            />
            {processing ? (
              <View
                style={[local.processing, { backgroundColor: theme.colors.scrim }]}
                accessibilityViewIsModal
                aria-busy
              >
                <View
                  style={[local.processingPanel, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLiveRegion="assertive"
                  accessibilityLabel={`${i18n.t("payment.card.processing.title")}. ${i18n.t("payment.card.processing.message")}`}
                >
                  <ActivityIndicator color={theme.colors.actionPrimary} />
                  <AppText variant="cardTitle" align="center">{i18n.t("payment.card.processing.title")}</AppText>
                  <AppText variant="meta" tone="muted" align="center">{i18n.t("payment.card.processing.message")}</AppText>
                </View>
              </View>
            ) : null}
          </View>
        ) : preparationError ? (
          <View style={local.messageArea}>
            <StatePanel
              variant="error"
              title={i18n.t("payment.unavailable.title")}
              message={i18n.t("payment.card.prepareFailed")}
              action={{ label: i18n.t("payment.retry"), onPress: () => void preparePayment(true) }}
              secondaryAction={{ label: i18n.t("payment.back"), onPress: returnToCheckout }}
            />
          </View>
        ) : (
          <View
            style={local.loadingArea}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={i18n.t("payment.card.loading")}
            aria-busy
          >
            <ActivityIndicator color={theme.colors.actionPrimary} />
            <AppText variant="meta" tone="muted">{i18n.t("payment.card.loading")}</AppText>
          </View>
        )}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  root: { flex: 1, width: "100%" },
  header: { width: "100%", paddingHorizontal: 14, gap: spacing.sm, paddingBottom: spacing.sm },
  amount: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  paymentArea: { flex: 1, width: "100%" },
  messageArea: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  loadingArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  processing: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  processingPanel: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
});
