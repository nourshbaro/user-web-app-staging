import { FlowHeader } from "@/components/FlowHeader";
import { CybersourceUnifiedCheckout } from "@/components/CybersourceUnifiedCheckout";
import { PaymentOutcomePanel, UnknownOutcomeSteps } from "@/components/checkout/PaymentOutcome";
import { AppText, StatePanel } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { failureReason } from "@/lib/userFacingError";
import {
  clearCardPaymentHandoff,
  readCardPaymentHandoff,
  saveCardPaymentRetry,
  takeCardPaymentRetry,
  type CardPaymentRetry,
} from "@/lib/cardPaymentHandoff";
import { cardResultReference, cardSubmitCompletion, cardSubmitOrderReference } from "@/lib/cardPaymentResult";
import { cardFormErrorAction, type CardFormErrorDetails } from "@/lib/cardFormErrors";
import type { AuthenticationSnapshot } from "@/lib/authSessionOwnership";
import { useAuth } from "@/context/AuthContext";
import { captureAuthenticationSnapshot, isAuthenticationSnapshotCurrent } from "@/services/api";
import { canLeavePayment, cardResultSubmitBlocker, type PaymentFailureKind } from "@/lib/checkoutFlow";
import { useExpiredCardFormGrace } from "@/hooks/useExpiredCardFormGrace";
import {
  checkoutResultRouteParams,
  parseCheckoutResultParams,
  singlePurchasedMatchId,
} from "@/lib/checkoutResultParams";
import { spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import { PAYMENT_RECOVERY_TICKETS_ROUTE } from "@/lib/paymentRecoveryTickets";
import {
  acquirePaymentAttempt,
  isPaymentAttemptHeldByOther,
  markCardFormOpen,
  isCardAttemptBindingLive,
  markPaymentOutcomeUnknownIfLive,
  readPaymentAttempt,
  readPaymentOutcomeLock,
  recordUnresolvedCardResult,
  resolveUnresolvedCardResult,
  type CardAttemptBinding,
  type CardResultClaim,
  type PaymentAttempt,
} from "@/lib/paymentOutcomeLock";
import { checkoutService } from "@/services/checkout";
import type { CheckoutSubmitResponse } from "@/types";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type CardFailure =
  | { kind: "unavailable" }
  /** The shared cart gate is active: the cart must be re-read before paying. */
  | { kind: "reconcile" }
  /**
   * A payment for this session (or, scope "account", an earlier card result
   * of this account) is unresolved. `unreadable`: this device's record of
   * earlier card results cannot be read, so one cannot be ruled out.
   */
  | { kind: "locked"; scope?: "account"; unreadable?: boolean }
  /**
   * The card form ended without a result after the payer could use it (the
   * provider rejected it, or the WebView died). A payment may have been taken.
   */
  | { kind: "formEnded" }
  /**
   * The card form returned a result (it may have charged the card), but no
   * order was confirmed. `submitted`: whether it reached the submit call.
   * `saved`: whether the result was persisted on this device.
   */
  | { kind: "unresolved"; reason: string | null; submitted: boolean; reference: string | null; saved: boolean | null; canRetry?: boolean }
  /** The reservation expired while the card form was open: nothing was sent. */
  | { kind: "expired" }
  /** The attempt could not be recorded before submitting: nothing was sent. */
  | { kind: "notStarted" }
  /** Another payment attempt (e.g. BLUE) holds this session: nothing was sent. */
  | { kind: "inProgress" }
  /** `reason`: what the backend (or the transport) said about the failed submit. */
  | { kind: PaymentFailureKind; reason?: string | null };

/**
 * Why an unresolved result was not submitted. Neutral wording: none of these
 * says or implies that nothing was charged.
 */
function notSubmittedReason(i18n: ReturnType<typeof useI18n>, blocker: CardFailure | "notRecorded") {
  if (blocker === "notRecorded") return i18n.t("payment.card.unresolved.notRecorded");
  switch (blocker.kind) {
    case "expired":
      return i18n.t("payment.reservationGone");
    case "reconcile":
      return i18n.t("checkout.reconcile.message");
    case "locked":
    case "inProgress":
      return i18n.t("payment.card.unresolved.otherPending");
    default:
      return i18n.t("payment.card.sessionGone");
  }
}

function failureMessage(i18n: ReturnType<typeof useI18n>, failure: CardFailure, canRetry = false) {
  if (failure.kind === "unresolved") {
    return [
      failure.reason,
      i18n.t(canRetry
        ? failure.reference ? "payment.card.unresolved.retryWithReference" : "payment.card.unresolved.retryMessage"
        : failure.submitted ? "payment.card.unresolved.message" : "payment.card.unresolved.notSubmitted"),
      failure.reference ? i18n.t("payment.card.unresolved.reference", { reference: failure.reference }) : null,
      // null: not known yet; only a write no store accepted is reported.
      failure.saved === false ? i18n.t("payment.card.unresolved.notSaved") : null,
    ].filter(Boolean).join(" ");
  }
  if (failure.kind === "locked" && failure.unreadable) return i18n.t("checkout.paymentUnknown.unreadableMessage");
  if (failure.kind === "locked" && failure.scope === "account") return i18n.t("checkout.paymentUnknown.accountMessage");
  if (failure.kind === "formEnded") return i18n.t("payment.card.formEnded.message");
  const reason = "reason" in failure ? failure.reason : null;
  if (reason) {
    // An unknown outcome keeps its guidance: the payment may have gone through.
    return failure.kind === "unknown" ? `${reason} ${i18n.t("payment.failed.unknown")}` : reason;
  }
  switch (failure.kind) {
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
 * Card payment. CyberSource Unified Checkout collects the card and, with
 * autoProcessing, may authorize the payment itself before resolving with its
 * result; this screen sends that result to `/checkout/mobile/submit`.
 * The result is recorded (`recordUnresolvedCardResult`) before any check and
 * blocks its checkout session (every method) and new card payments for the
 * account until a complete submit response resolves it. Only a complete
 * response (`cardSubmitCompletion`: a conservative narrowing, the backend
 * success contract is unconfirmed) for the still-current cart session clears
 * the cart (`clearCartIfSession`) and opens the success screen. Any other
 * ending (not submitted, 4xx, 5xx, timeout, network, a 2xx that does not
 * prove a paid order) is presented as unconfirmed, never as failed.
 *
 * A submitted result is never sent again: backend idempotency for the same
 * result is not established. Only a result that was never sent (held back
 * by the cart's "re-read first" gate) is sent later, once: the cart is
 * re-read at once and the result sent when the read confirms the session;
 * otherwise from the button here, Checkout or My Tickets.
 *
 * The client-side reservation timer does not destroy this flow: the cart
 * owner defers its expiry while the form is open, a result is being handled
 * (`markCardFormOpen`), or a never-sent result is held (`hasHeldCardResult`).
 * After the timer ends the form is locked (covered, focus removed, hidden
 * from screen readers) and kept for `CARD_FORM_EXPIRY_GRACE_MS` of
 * foreground time, so a result CyberSource is already processing still
 * arrives and is submitted; the backend decides whether the reservation is
 * still valid. Leaving an open form asks first. A form that ends without a
 * result after the payer could use it (provider error, WebView process gone)
 * is an unknown outcome, never a cancellation. If the app dies before the
 * form hands over its result, only backend reconciliation can recover it.
 */
export function CardPaymentScreen() {
  const theme = useTheme();
  const cart = useCart();
  const toast = useToast();
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ handoff?: string | string[]; from?: string | string[] }>();
  const handoffId = firstParam(params.handoff) ?? "";
  const fromTickets = firstParam(params.from) === "tickets";
  const [handoff] = useState(() => readCardPaymentHandoff(handoffId));
  const submittingRef = useRef(false);
  const activeRef = useRef(true);
  // True while the expired form is held for its grace period: leaving would
  // tear down a form that may still deliver a payment result.
  const expiryGraceRef = useRef(false);
  const [captureContext, setCaptureContext] = useState<string | null>(
    handoff?.captureContext ?? null,
  );
  // The reason the card form could not be prepared, or null.
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  // A held (never sent) result: the cart re-read before sending it, and whether to send it once automatically.
  const recheckingRef = useRef(false);
  const [rechecking, setRechecking] = useState(false);
  const autoSendHeldRef = useRef(false);
  // The card form result this screen recorded and may submit (at most one).
  const ownResultRef = useRef<CardResultClaim | null>(handoff?.retry?.claim ?? null);
  const auth = useAuth();
  const signedInAccount = auth.user ? String(auth.user.id) : null;
  const signedInAccountRef = useRef<string | null>(signedInAccount);
  useEffect(() => {
    signedInAccountRef.current = signedInAccount;
  }, [signedInAccount]);
  // The authentication that opened this card form, captured only while the
  // signed-in account is the handoff's. A submit goes out only while this
  // snapshot is still current, pinned to its token: a late callback can never
  // submit under an account that signed in afterwards.
  const [authSnapshot, setAuthSnapshot] = useState<AuthenticationSnapshot | null>(null);
  const [failure, setFailure] = useState<CardFailure | null>(() => {
    if (!handoff) return { kind: "unavailable" };
    const retry = handoff.retry;
    if (retry) {
      // A held-back result: it was never sent.
      const { reason, reference, saved } = retry;
      return { kind: "unresolved", reason, reference, saved, submitted: false, canRetry: true };
    }
    const lock = readPaymentOutcomeLock(handoff.sessionId);
    return lock
      ? { kind: "locked", scope: lock.scope, unreadable: lock.reason === "unreadable" }
      : isPaymentAttemptHeldByOther(handoff.sessionId, null)
        ? { kind: "inProgress" }
        : null;
  });
  useEffect(() => {
    if (!handoff || handoff.retry) return;
    let active = true;
    void captureAuthenticationSnapshot().then(
      (snapshot) => {
        if (!active) return;
        const sameAccount = handoff.accountId !== null && signedInAccountRef.current === handoff.accountId;
        if (snapshot.token && sameAccount) setAuthSnapshot(snapshot);
        else setFailure((existing) => existing ?? { kind: "unavailable" });
      },
      () => {
        if (active) setFailure((existing) => existing ?? { kind: "unavailable" });
      },
    );
    return () => {
      active = false;
    };
  }, [handoff]);

  const returnToCheckout = useCallback(() => {
    if (!readCardPaymentHandoff(handoffId)?.retry) clearCardPaymentHandoff(handoffId);
    router.dismissTo(fromTickets ? "/tickets" : "/checkout");
  }, [fromTickets, handoffId]);

  // True while the card form is on screen (set below, read by the Back handlers).
  const cardFormVisibleRef = useRef(false);
  // Leaving while the form is on screen destroys it, and with it the result of
  // a payment the payer may already have started in it: ask first.
  const requestLeave = useCallback(() => {
    if (!canLeavePayment(submittingRef) || expiryGraceRef.current) return;
    if (!cardFormVisibleRef.current) {
      returnToCheckout();
      return;
    }
    const title = i18n.t("payment.card.leave.title");
    const message = i18n.t("payment.card.leave.message");
    const leave = () => {
      if (canLeavePayment(submittingRef) && !expiryGraceRef.current) returnToCheckout();
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) leave();
      return;
    }
    Alert.alert(title, message, [
      { text: i18n.t("payment.card.leave.stay"), style: "cancel" },
      { text: i18n.t("payment.card.leave.confirm"), style: "destructive", onPress: leave },
    ]);
  }, [i18n, returnToCheckout]);

  useEffect(() => {
    activeRef.current = true;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        // A submitted payment is in flight, or the expired form is held: leaving now could hide its result.
        if (canLeavePayment(submittingRef) && !expiryGraceRef.current) requestLeave();
        return true;
      },
    );
    return () => {
      activeRef.current = false;
      subscription.remove();
      if (!readCardPaymentHandoff(handoffId)?.retry) clearCardPaymentHandoff(handoffId);
    };
  }, [handoffId, requestLeave]);

  const viewTickets = useCallback(() => {
    if (!canLeavePayment(submittingRef) || expiryGraceRef.current) return;
    router.replace(PAYMENT_RECOVERY_TICKETS_ROUTE);
  }, []);

  const preparePayment = useCallback(async (force = false) => {
    if (!handoff || cart.sessionId !== handoff.sessionId) return;
    setPreparationError(null);
    try {
      const context = await handoff.prepareCaptureContext(force);
      if (activeRef.current && cart.sessionId === handoff.sessionId) setCaptureContext(context);
    } catch (error) {
      if (activeRef.current && cart.sessionId === handoff.sessionId) {
        // Checkout's capture-context owner rejects with the backend's reason.
        setPreparationError(
          error instanceof Error && error.message ? error.message : i18n.t("payment.card.prepareFailed"),
        );
      }
    }
  }, [cart.sessionId, handoff, i18n]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && !failure && !captureContext && !preparationError) void preparePayment();
    });
    return () => {
      active = false;
    };
  }, [captureContext, failure, preparationError, preparePayment]);

  // Current owner state, not the last render: a changed or unconfirmed cart,
  // an unknown earlier payment for this session, or another attempt holding
  // it, never submits. The client-side expiry timer alone does not stop a
  // result the form already returned (`cardResultSubmitBlocker`): the backend
  // decides whether the reservation is still valid. Run before the attempt is
  // acquired (own = null) and again right before the submit (own = this
  // attempt). `result`: the card result this screen recorded, which passes
  // its own gate; any other unresolved result still blocks.
  const submitBlock = useCallback((sessionId: string, own: PaymentAttempt | null, result: CardResultClaim | null): CardFailure | null => {
    const owner = cart.readCartGuardState();
    const blocker = cardResultSubmitBlocker({
      sessionId,
      owner: {
        ...owner,
        paymentOutcomeUnknown: readPaymentOutcomeLock(sessionId, result) !== null,
        paymentAttemptInProgress: isPaymentAttemptHeldByOther(sessionId, own),
      },
    });
    return blocker === null ? null : { kind: blocker === "changed" ? "unavailable" : blocker };
  }, [cart]);

  const handleSuccess = useCallback(
    async (cardResult: string, retry?: CardPaymentRetry) => {
      // With autoProcessing the card form may already have authorized the
      // payment: this result is the only client evidence of it. Record it
      // (account + session + submission context) before any other check, so
      // no path below can drop it. Its claims are not trusted for anything.
      // Bound to the account and cart session that opened this form (the
      // handoff), never to whatever is current when the callback lands.
      const reference = retry ? retry.reference : cardResultReference(cardResult);
      const { claim, persisted } = retry ? { claim: retry.claim, persisted: null } : recordUnresolvedCardResult({
        accountId: handoff?.accountId ?? null,
        sessionId: handoff?.sessionId ?? null,
        result: cardResult,
        reference,
      });
      // What this attempt is bound to: the handoff's cart session and the
      // authentication that opened the form. It is live only while that
      // session is the mounted cart owner's (never a retired provider's) and
      // that authentication is still current for the handoff's account.
      const snapshot = retry?.snapshot ?? authSnapshot;
      const binding: CardAttemptBinding | null = handoff && snapshot
        ? {
          sessionId: handoff.sessionId,
          isAuthenticationCurrent: () => isAuthenticationSnapshotCurrent(snapshot) && signedInAccountRef.current === handoff.accountId,
        }
        : null;
      // Every session-lock write goes through the binding: a callback from an
      // inactive screen, a retired provider or an earlier sign-in never
      // replaces a newer session's lock (the marker above already blocks).
      const lockHandoffSession = () => {
        if (binding) markPaymentOutcomeUnknownIfLive(binding, "card");
      };
      // A repeated delivery of the result being handled, or any result while
      // a submit is in flight: recorded above, never submitted twice.
      if (submittingRef.current || (!retry && ownResultRef.current?.key === claim.key)) return;
      if (!retry && ownResultRef.current) {
        // A second, different result: recorded and blocking, never submitted here.
        takeCardPaymentRetry(handoffId);
        lockHandoffSession();
        const saved = (await persisted) ?? false;
        if (activeRef.current) setFailure({ kind: "unresolved", reason: null, submitted: false, reference, saved });
        return;
      }
      ownResultRef.current = claim;
      submittingRef.current = true;
      // Held synchronously from the moment the result is handled until it
      // settles: no countdown tick before the next render can let the cart
      // owner's expiry clear the session under it.
      const releaseExpiryHold = handoff ? markCardFormOpen(handoff.sessionId) : () => {};
      if (!retry) setFailure(null);
      setProcessing(true);
      // null: the marker write has not settled yet (nothing is said about it).
      let saved: boolean | null = retry ? retry.saved : persisted ? null : false;
      let attempt: PaymentAttempt | null = retry?.attempt ?? null;
      // A retry is only ever a result that was never sent (see below).
      let submitted = false;
      // The marker write runs on its own queue and is never awaited before the
      // submit: waiting for it would only widen the gap between a possible
      // charge and the order. Its outcome is reported once known (a failed
      // write is told to the user, never silently ignored; the marker then
      // lives only in this process, still blocking payments).
      const savedKnown = persisted ? persisted.then((value) => { saved = value; }) : Promise.resolve();
      const reportSaved = () => {
        void savedKnown.then(() => {
          if (activeRef.current) {
            setFailure((existing) => (existing?.kind === "unresolved" && existing.saved === null ? { ...existing, saved } : existing));
          }
        });
      };
      // Not submitted: the result stays recorded and the session stays locked.
      // Never "nothing was charged": the card form may have charged it.
      // Synchronous, so nothing between the final re-check and the submit awaits.
      const keepUnsubmitted = (blocker: CardFailure | "notRecorded") => {
        lockHandoffSession();
        if (activeRef.current) {
          setFailure({ kind: "unresolved", reason: notSubmittedReason(i18n, blocker), submitted, reference, saved });
        }
        reportSaved();
      };
      try {
        if (!handoff || cart.sessionId !== handoff.sessionId) {
          keepUnsubmitted({ kind: "unavailable" });
          return;
        }
        const cartTicket = retry?.cartTicket ?? cart.captureCartSession();
        if (!cartTicket || cartTicket.sessionId !== handoff.sessionId) {
          keepUnsubmitted({ kind: "unavailable" });
          return;
        }
        const sessionId = handoff.sessionId;
        if (!binding || !isCardAttemptBindingLive(binding)) {
          keepUnsubmitted({ kind: "unavailable" });
          return;
        }
        if (!attempt) {
          const blockedAtToken = submitBlock(sessionId, null, claim);
          // The cart's "re-read first" gate does not stop the attempt being
          // held (that sends nothing): the result is then kept, unsent, for
          // one later submission once the cart is confirmed (below).
          if (blockedAtToken && blockedAtToken.kind !== "reconcile") {
            keepUnsubmitted(blockedAtToken);
            return;
          }
          // Persist the first attempt before sending anything to the backend.
          // A manual retry keeps that same attempt and its original claim.
          const acquisition = await acquirePaymentAttempt(sessionId, "card", claim, binding);
          if (!acquisition.ok) {
            keepUnsubmitted(acquisition.reason === "blocked" ? submitBlock(sessionId, null, claim) ?? { kind: "inProgress" } : "notRecorded");
            return;
          }
          attempt = acquisition.attempt;
        }
        // The reservation can expire (or change) while the card form is
        // open: re-check the owner immediately before the submit. This
        // attempt passes its own gate; nothing else would.
        // Same account and live cart: the authentication that opened the form
        // is still current (no sign-out or sign-in since) and its session is
        // the mounted owner's. The request is pinned to that snapshot: its
        // token is sent, and a 401/403 can end only that authentication.
        const blockedBeforeSubmit = submitBlock(sessionId, attempt, claim)
          ?? (cart.isCartSessionCurrent(cartTicket) ? null : { kind: "unavailable" as const })
          ?? (activeRef.current && snapshot && isCardAttemptBindingLive(binding)
            && readPaymentAttempt(sessionId)?.id === attempt.id ? null : { kind: "unavailable" as const });
        if (blockedBeforeSubmit || !snapshot) {
          if (snapshot && blockedBeforeSubmit?.kind === "reconcile") {
            // Never sent: kept in memory only (never persisted) with its held
            // attempt, so it can be sent once after the cart is re-read. This
            // is a first submission, not a replay.
            const reason = notSubmittedReason(i18n, blockedBeforeSubmit);
            const pending = retry ?? { cardResult, snapshot, cartTicket, claim, attempt, reference, reason, saved };
            saveCardPaymentRetry(handoffId, pending);
            void savedKnown.then(() => { pending.saved = saved; });
            // The cart is re-read now and, once confirmed, the result is sent
            // (once). It is the first submission of this result.
            if (!retry) autoSendHeldRef.current = true;
            if (activeRef.current) setFailure({ kind: "unresolved", reason, submitted, reference, saved, canRetry: true });
            reportSaved();
            return;
          }
          keepUnsubmitted(blockedBeforeSubmit ?? { kind: "unavailable" });
          return;
        }
        submitted = true;
        // Sent at most once. A transport error or timeout leaves the outcome
        // unknown (the backend may have created the order), and resubmitting
        // the same result is not known to be idempotent: it is never resent.
        // A body that did not parse arrives as null at runtime (`apiRequest`);
        // `cardSubmitCompletion` treats that as unresolved.
        const response = await checkoutService.submit(
          { ...handoff.request, payment: { transient_token: cardResult } },
          { authentication: snapshot },
        );
        // One completion decision (shared with user-web: a 2xx without
        // `payment.payment_url`) for the success screen, clearing the
        // matching cart and releasing the marker. Otherwise the result stays
        // unresolved, the cart is kept, and paying again stays blocked.
        if (cardSubmitCompletion(response) !== "complete") {
          lockHandoffSession();
          await savedKnown;
          if (activeRef.current) {
            const unconfirmed: CardFailure = {
              kind: "unresolved",
              reason: i18n.t("payment.card.unresolved.unconfirmedResponse"),
              submitted: true,
              // An order the response named (unverified) helps support most.
              reference: cardSubmitOrderReference(response) ?? reference,
              saved,
            };
            setFailure(unconfirmed);
            toast.showToast({ variant: "error", title: i18n.t("payment.card.unresolved.title"), message: failureMessage(i18n, unconfirmed) });
          }
          return;
        }
        await resolveUnresolvedCardResult(claim);
        if (!cart.isCartSessionCurrent(cartTicket)) return;
        if (!activeRef.current) {
          // Complete, but this screen is gone and cannot reconcile it with
          // the cart: never payable again (like BLUE's unreconciled success),
          // and only through the live binding. The cart is not cleared here.
          lockHandoffSession();
          return;
        }
        // Complete implies a JSON object body (`cardSubmitCompletion`).
        const details: CheckoutSubmitResponse = response ?? {};
        const resultParams = checkoutResultRouteParams(
          parseCheckoutResultParams({
            provider: "cybersource",
            // Display-only: which match's tickets "View my ticket" opens.
            match_id: singlePurchasedMatchId(handoff.request.tickets_by_match),
            order_id: details.order_id,
            order_number: details.order_number,
            reference:
              details.reference ??
              details.payment_reference ??
              details.payment?.reference ??
              details.payment?.payment_reference,
            status: details.status ?? details.payment?.status,
          }),
        );
        const cleared = await cart.clearCartIfSession(cartTicket);
        if (!cleared || !activeRef.current || !isAuthenticationSnapshotCurrent(snapshot)) return;
        clearCardPaymentHandoff(handoffId);
        const resetRouter = router as typeof router & {
          dismissAll?: () => void;
        };
        resetRouter.dismissAll?.();
        router.replace({ pathname: "/checkout/success", params: resultParams });
      } catch (submissionError) {
        // Any failure after a card result (4xx, 5xx, 401/403, 503, timeout,
        // network): no order is confirmed and the card may have been charged.
        // No backend contract makes any of these final, so the result stays
        // recorded and the session is locked, never settled. Decided even if
        // this screen is gone, so the lock is never skipped; only for the
        // handoff's session while it is still current.
        lockHandoffSession();
        await savedKnown.catch(() => undefined);
        if (!activeRef.current) return;
        const failed: CardFailure = {
          kind: "unresolved",
          reason: failureReason(submissionError),
          submitted,
          reference,
          saved,
        };
        setFailure(failed);
        toast.showToast({
          variant: "error",
          title: i18n.t("payment.card.unresolved.title"),
          message: failureMessage(i18n, failed),
        });
      } finally {
        submittingRef.current = false;
        releaseExpiryHold();
        if (activeRef.current) setProcessing(false);
      }
    },
    [authSnapshot, cart, handoff, handoffId, i18n, submitBlock, toast],
  );

  // Sends the held (never sent) result once. The cart's "re-read first" gate
  // held it, so the cart is re-read first; only a confirmed read for the same
  // session lets it go. A failed read keeps it held (the button retries); a
  // backend answer that ends the session leaves it unresolved (its marker
  // stays: only backend reconciliation can settle it then).
  const retrySubmission = useCallback(async () => {
    if (!activeRef.current || submittingRef.current || recheckingRef.current) return;
    if (cart.readCartGuardState().reconciliationRequired) {
      recheckingRef.current = true;
      setRechecking(true);
      let confirmed = false;
      try {
        confirmed = (await cart.refreshCart()).confirmed;
      } catch {
        confirmed = false;
      } finally {
        recheckingRef.current = false;
        if (activeRef.current) setRechecking(false);
      }
      if (!confirmed || !activeRef.current || submittingRef.current || cart.readCartGuardState().reconciliationRequired) return;
    }
    const retry = takeCardPaymentRetry(handoffId);
    if (retry) void handleSuccess(retry.cardResult, retry);
  }, [cart, handleSuccess, handoffId]);

  useEffect(() => {
    if (!autoSendHeldRef.current || failure?.kind !== "unresolved" || !failure.canRetry || processing) return;
    autoSendHeldRef.current = false;
    void retrySubmission();
  }, [failure, processing, retrySubmission]);

  // The form ended without a result. Before the payer could use it, its own
  // Retry reloads it. After, a payment may have been taken: shown as an
  // unknown outcome, never as a cancellation, and not reloaded in place.
  const handleFormError = useCallback((_message: string, details: CardFormErrorDetails) => {
    if (cardFormErrorAction(details) !== "outcomeUnknown" || !activeRef.current) return;
    // A result already handed over is handled by its own path.
    if (ownResultRef.current !== null || submittingRef.current) return;
    setFailure((existing) => existing ?? { kind: "formEnded" });
  }, []);

  const sessionMismatch = !handoff || cart.sessionId !== handoff.sessionId;
  const outcomeUncertain = failure?.kind === "unknown" || failure?.kind === "locked" || failure?.kind === "unresolved" || failure?.kind === "formEnded";
  // Not gated on the client timer: the held result was never sent, and the
  // backend decides whether the reservation is still valid.
  const canRetry = failure?.kind === "unresolved" && failure.canRetry === true && !processing
    && !sessionMismatch && signedInAccount === handoff?.accountId
    && handoff.retry !== undefined && isAuthenticationSnapshotCurrent(handoff.retry.snapshot);
  // While the card form is on screen a payment may complete in it at any
  // moment: an expiry notice must not then say "no payment was taken".
  // The form opens only once the authentication that owns it is captured.
  const cardFormVisible = !failure && !sessionMismatch && captureContext !== null && authSnapshot !== null;
  useEffect(() => {
    cardFormVisibleRef.current = cardFormVisible;
  }, [cardFormVisible]);
  const formSessionId = handoff?.sessionId ?? null;
  // The payment is active while the form is on screen or its result is being
  // submitted: the cart owner defers its client-side expiry until released.
  const paymentActive = cardFormVisible || processing;
  useEffect(() => {
    if (!paymentActive || formSessionId === null) return;
    return markCardFormOpen(formSessionId);
  }, [paymentActive, formSessionId]);

  // The reservation timer ended while the form is open. The form stays
  // mounted (an authorization CyberSource is already processing can still
  // deliver its result) but is covered, so no new payment can be started in
  // it. With no result after the grace period it closes, which releases the
  // hold and lets the cart owner run its expiry.
  // Re-evaluated on every cart update (the owner publishes each second).
  const formExpired = cardFormVisible && cart.readCartGuardState().expired;
  useExpiredCardFormGrace(
    formExpired,
    expiryGraceRef,
    () => ownResultRef.current !== null || submittingRef.current,
    () => {
      if (activeRef.current) setFailure((existing) => existing ?? { kind: "expired" });
    },
  );

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
        {/* v3 flow header; the reservation countdown is the one global bar above (read-only here). */}
        <FlowHeader
          title={i18n.t("payment.card.title")}
          subtitle={i18n.t("payment.secure")}
          backLabel={i18n.t(fromTickets ? "myTickets.title" : "checkout.title")}
          // The synchronous in-flight ref decides, so a press that lands before
          // the re-render still cannot leave and drop the payment's result.
          onBack={() => {
            if (canLeavePayment(submittingRef) && !expiryGraceRef.current) requestLeave();
          }}
          backDisabled={processing || formExpired || rechecking}
        />
        {!sessionMismatch && !failure ? (
          <View style={[local.amount, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
            <AppText variant="meta" tone="muted">{i18n.t("checkout.total")}</AppText>
            <AppText variant="numeric">{formatMoney(cart.total, cart.currency)}</AppText>
          </View>
        ) : null}
      </View>
      <View style={[local.paymentArea, { paddingBottom: insets.bottom }]}>
        {failure || sessionMismatch ? (
          <View style={local.messageArea}>
            <PaymentOutcomePanel
              variant={outcomeUncertain ? "unknown" : "failed"}
              title={
                failure?.kind === "unresolved"
                  ? i18n.t("payment.card.unresolved.title")
                  : outcomeUncertain
                  ? i18n.t("payment.unknown.title")
                  : failure?.kind === "reconcile"
                    ? i18n.t("cart.unconfirmed.title")
                    : failure && failure.kind !== "unavailable" && failure.kind !== "expired" && failure.kind !== "notStarted" && failure.kind !== "inProgress"
                      ? i18n.t("payment.failed.title")
                      : i18n.t("payment.unavailable.title")
              }
              message={failure ? failureMessage(i18n, failure, canRetry) : i18n.t("payment.reservationGone")}
              action={
                processing || rechecking ? undefined : canRetry
                  ? { label: i18n.t("payment.card.unresolved.retrySubmit"), onPress: () => void retrySubmission() }
                  : outcomeUncertain
                  ? { label: i18n.t("payment.viewTickets"), onPress: viewTickets }
                  : { label: i18n.t(fromTickets ? "payment.viewTickets" : "payment.back"), onPress: returnToCheckout }
              }
              secondaryAction={
                !processing && !canRetry && outcomeUncertain
                  ? { label: i18n.t(fromTickets ? "myTickets.back" : "payment.back"), onPress: returnToCheckout }
                  : undefined
              }
            >
              {/* The steps end with "only try again if…": not shown where paying again stays blocked. */}
              {failure?.kind === "unknown" || failure?.kind === "formEnded" || (failure?.kind === "locked" && failure.scope !== "account" && !failure.unreadable) ? <UnknownOutcomeSteps /> : null}
            </PaymentOutcomePanel>
          </View>
        ) : captureContext && authSnapshot ? (
          <View style={local.paymentArea}>
            <CybersourceUnifiedCheckout
              captureContext={captureContext}
              onSuccess={handleSuccess}
              onError={handleFormError}
              fullscreen
              locked={formExpired}
            />
          </View>
        ) : preparationError ? (
          <View style={local.messageArea}>
            <StatePanel
              variant="error"
              title={i18n.t("payment.unavailable.title")}
              message={preparationError}
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
        {formExpired && !processing ? (
          // Covers (does not unmount) the form: touches cannot start a new
          // payment, while a result already being processed can still arrive.
          <View
            style={[local.processing, { backgroundColor: theme.colors.scrim }]}
            accessibilityViewIsModal
          >
            <View
              style={[local.processingPanel, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowRaised }]}
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={`${i18n.t("payment.card.expiredGrace.title")}. ${i18n.t("payment.card.expiredGrace.message")}`}
            >
              <ActivityIndicator color={theme.colors.actionPrimary} />
              <AppText variant="cardTitle" align="center">{i18n.t("payment.card.expiredGrace.title")}</AppText>
              <AppText variant="meta" tone="muted" align="center">{i18n.t("payment.card.expiredGrace.message")}</AppText>
            </View>
          </View>
        ) : null}
        {processing ? (
          <View
            style={[local.processing, { backgroundColor: theme.colors.scrim }]}
            accessibilityViewIsModal
            aria-busy
          >
            <View
              style={[local.processingPanel, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowRaised }]}
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
    </View>
  );
}

const local = StyleSheet.create({
  root: { flex: 1, width: "100%" },
  header: { width: "100%", paddingHorizontal: 14, gap: spacing.sm, paddingBottom: spacing.sm },
  // v3 summary card (surface + card shadow, radius 16), not the legacy bordered box.
  amount: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  paymentArea: { flex: 1, width: "100%" },
  messageArea: { flex: 1, padding: spacing.xxl, justifyContent: "center" },
  loadingArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  processing: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  processingPanel: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 20,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
});
