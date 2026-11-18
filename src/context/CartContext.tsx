import { translate } from "@/i18n/runtime";
import { useAuth } from "@/context/AuthContext";
import { router } from "expo-router";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Keyboard, Platform } from "react-native";
import {
  isCartExpiryReached,
  parsePersistedCartSession,
  serializePersistedCartSession,
} from "@/lib/cartPersistence";
import { classifyCartRefreshFailure, createCartRefreshGuard } from "@/lib/cartRefreshPolicy";
import { discardStaleCardPaymentRetry, hasHeldCardResult } from "@/lib/cardPaymentHandoff";
import { createCartOperationQueue } from "@/lib/cartOperationQueue";
import {
  clearPendingBluePaymentAttempt,
  invalidatePendingBluePaymentAttemptUnlessSession,
  readPendingBluePaymentAttempt,
} from "@/lib/bluePaymentHandoff";
import { expiredHoldFrom, type ExpiredHold } from "@/lib/holdExpiry";
import {
  clearCartSessionIfCurrent,
  createCartSessionAuthority,
  publishCartSessionIfCurrent,
  type CartSessionTicket,
} from "@/lib/cartSessionAuthority";
import { addWithSessionRecovery, createSingleFlight } from "@/lib/cartSessionRecovery";
import {
  confirmedPublication,
  unconfirmedPublication,
  type CartPublicationResult,
} from "@/lib/cartPublication";
import {
  NO_RECONCILIATION,
  dropIfSessionEnded,
  failureIsAmbiguous,
  raiseReconciliation,
  reconciliationActive,
  releaseAfterRead,
  runGroupedRemoval,
  type CartReconciliation,
  type CartReconciliationReason,
} from "@/lib/cartReconciliation";
import { errorFacts } from "@/lib/apiErrorFacts";
import {
  configurePaymentOutcomeStore,
  configureUnresolvedCardResultStore,
  discardPaymentOutcomeUnlessSession,
  isCardFormOpen,
  readPaymentAttempt,
  readPaymentOutcomeLock,
  registerCartOwner,
  restorePaymentOutcomeLock,
  selectPaymentAccount,
} from "@/lib/paymentOutcomeLock";
import { storage } from "@/lib/storage";
import { unresolvedCardResultStorage } from "@/lib/unresolvedCardResultStorage";
import { userFacingError } from "@/lib/userFacingError";
import { ApiError, isAuthenticationSnapshotCurrent } from "@/services/api";
import { cartService, getCartItems } from "@/services/cart";
import type { AddCartRequest, CartItem } from "@/types";

const SESSION_KEY = "lfa_cart_session_id";
const PAYMENT_OUTCOME_KEY = "lfa_payment_outcome_lock";

// The unknown-payment lock is keyed by this owner's session id and restored
// with it (see paymentOutcomeLock.ts); it holds no payment status itself.
configurePaymentOutcomeStore({
  get: () => storage.get(PAYMENT_OUTCOME_KEY),
  set: (value) => storage.set(PAYMENT_OUTCOME_KEY, value),
  remove: () => storage.remove(PAYMENT_OUTCOME_KEY),
});
// Unresolved card results are account-scoped and outlive cart sessions,
// restarts and sign-out; they are not a user-scoped cache.
configureUnresolvedCardResultStore(unresolvedCardResultStorage);

/**
 * Resolved by addItem/updateItem/removeItem/refreshCart: whether the resulting
 * cart was published for the current session (see `cartPublication.ts`).
 * Callers that only need completion can ignore it.
 */
export type CartPublication = CartPublicationResult<CartItem>;

/**
 * Result of a grouped removal (`removeItems`). Like CartPublication, a
 * resolved promise is not success on its own:
 * - notPerformed: no delete was sent;
 * - confirmed: every delete succeeded and the resulting cart was published
 *   for the same session;
 * - sessionEnded: the session ended (expiry/clear) during the removal, so the
 *   empty cart proves nothing about the requested delete;
 * - ambiguous: some deletes may have been applied (partial or unconfirmed);
 *   the shared reconciliation gate is raised.
 * A definite rejection of every delete (nothing applied) throws, as before.
 */
export type CartRemovalResult =
  | { status: "notPerformed"; reason: "no-session" | "session-changed" | "reconciliation-required" }
  | { status: "confirmed"; publication: CartPublication }
  | { status: "sessionEnded"; applied: string[]; failed: string[] }
  | { status: "ambiguous"; applied: string[]; failed: string[] };

/** Owner state read synchronously at the moment of a payment action. */
export type CartGuardState = {
  sessionId: string | null;
  itemCount: number;
  expired: boolean;
  reconciliationRequired: boolean;
};

type CartContextValue = {
  sessionId: string | null;
  items: CartItem[];
  total: number;
  currency: string;
  secondsLeft: number;
  isLoading: boolean;
  cartRefreshError: string | null;
  addItem: (payload: Omit<AddCartRequest, "checkout_session_id">) => Promise<CartPublication>;
  removeItem: (lockKey: string) => Promise<CartPublication>;
  removeItems: (lockKeys: string[]) => Promise<CartRemovalResult>;
  updateItem: (lockKey: string, quantity: number) => Promise<CartPublication>;
  refreshCart: () => Promise<CartPublication>;
  /** Shared "re-read the cart first" gate (see `cartReconciliation.ts`). */
  cartReconciliation: CartReconciliation;
  /** True while the gate applies to the current session; read synchronously. */
  isCartReconciliationRequired: () => boolean;
  requireCartReconciliation: (reason: CartReconciliationReason) => void;
  readCartGuardState: () => CartGuardState;
  clearCart: () => Promise<void>;
  captureCartSession: () => CartSessionTicket | null;
  isCartSessionCurrent: (ticket: CartSessionTicket) => boolean;
  clearCartIfSession: (ticket: CartSessionTicket) => Promise<CartSessionTicket | null>;
  /**
   * The reservation that just expired (v3 "Reservation expired"): only its
   * unique match ids and whether a payment touched it, captured before the
   * clear. Presentation data, never a cart authority.
   */
  expiredHold: ExpiredHold | null;
  dismissExpiredHold: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function dismissEverythingAndGoHome() {
  Keyboard.dismiss();
  const resetRouter = router as typeof router & { dismissAll?: () => void };
  resetRouter.dismissAll?.();
  router.replace("/");
}

export function CartProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [expiredHold, setExpiredHold] = useState<ExpiredHold | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isLoading, setLoading] = useState(false);
  const [cartRefreshError, setCartRefreshError] = useState<string | null>(null);
  const [cartReconciliation, setCartReconciliationState] = useState<CartReconciliation>(NO_RECONCILIATION);
  const reconciliationRef = useRef<CartReconciliation>(NO_RECONCILIATION);
  const itemsRef = useRef<CartItem[]>([]);
  const expiresAtRef = useRef<Date | null>(null);
  const expiryHandledRef = useRef(false);
  // The session whose client-side expiry was deferred for an active card payment.
  const expiryDeferredForCardRef = useRef<string | null>(null);
  const refreshGuardRef = useRef(createCartRefreshGuard());
  const addMutationGuardRef = useRef(createSingleFlight());
  const mountedRef = useRef(true);
  const sessionAuthorityRef = useRef(createCartSessionAuthority());
  const [operationQueue] = useState(() => createCartOperationQueue(setLoading));

  const publishCartResponseIfCurrent = useCallback(
    (
      expected: CartSessionTicket,
      response: Awaited<ReturnType<typeof cartService.get>>,
      publish: () => void,
    ) => {
      const persisted = serializePersistedCartSession(
        response.checkout_session_id,
        response.expires_at,
      );

      return publishCartSessionIfCurrent({
        authority: sessionAuthorityRef.current,
        expected,
        persist: () => persisted
          ? storage.set(SESSION_KEY, persisted)
          : storage.remove(SESSION_KEY),
        canPublish: () => mountedRef.current,
        publish,
      });
    },
    [],
  );

  const resetCartDisplayState = useCallback(() => {
    clearPendingBluePaymentAttempt();
    // A later reset (logout, another session) also retires an expired-hold notice;
    // expiry sets its snapshot after this reset.
    setExpiredHold(null);
    setSessionId(null);
    setExpiresAt(null);
    setItems([]);
    setTotal(0);
    setCurrency("USD");
    setSecondsLeft(0);
    setCartRefreshError(null);
    // The owner ended this session: its gate (if any) no longer applies.
    reconciliationRef.current = dropIfSessionEnded(reconciliationRef.current, null);
    setCartReconciliationState(reconciliationRef.current);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    expiresAtRef.current = expiresAt;
  }, [expiresAt]);

  const setReconciliation = useCallback((next: CartReconciliation) => {
    if (next === reconciliationRef.current) return;
    reconciliationRef.current = next;
    setCartReconciliationState(next);
  }, []);

  const raiseGate = useCallback((sessionId: string | null, reason: CartReconciliationReason) => {
    setReconciliation(raiseReconciliation(reconciliationRef.current, sessionId, reason));
  }, [setReconciliation]);

  const requireCartReconciliation = useCallback((reason: CartReconciliationReason) => {
    raiseGate(sessionAuthorityRef.current.currentSessionId(), reason);
  }, [raiseGate]);

  const isCartReconciliationRequired = useCallback(
    () => reconciliationActive(reconciliationRef.current, sessionAuthorityRef.current.currentSessionId()),
    [],
  );

  const readCartGuardState = useCallback((): CartGuardState => {
    const currentSessionId = sessionAuthorityRef.current.currentSessionId();
    return {
      sessionId: currentSessionId,
      itemCount: itemsRef.current.length,
      expired: isCartExpiryReached(expiresAtRef.current, Date.now()),
      reconciliationRequired: reconciliationActive(reconciliationRef.current, currentSessionId),
    };
  }, []);

  /**
   * Runs one mutation and raises the shared gate when its outcome is unknown:
   * an ambiguous failure (transport or server error), or an applied change
   * whose refresh could not be published.
   */
  const trackOutcome = useCallback(async (
    sessionId: string | null,
    run: () => Promise<CartPublication>,
  ): Promise<CartPublication> => {
    try {
      const result = await run();
      if (!result.confirmed && result.reason === "refresh-failed") raiseGate(sessionId, "unconfirmed-mutation");
      return result;
    } catch (error) {
      if (failureIsAmbiguous(errorFacts(error))) raiseGate(sessionId, "unconfirmed-mutation");
      throw error;
    }
  }, [raiseGate]);

  useEffect(() => {
    invalidatePendingBluePaymentAttemptUnlessSession(sessionId);
    // A different, current session never inherits another session's lock.
    // A null session is not "different": it may be a restore in progress.
    if (sessionId !== null) void discardPaymentOutcomeUnlessSession(sessionId);
  }, [sessionId]);

  const resetCartState = useCallback(() => {
    sessionAuthorityRef.current.replace(null);
    resetCartDisplayState();
  }, [resetCartDisplayState]);

  const captureCartSession = useCallback(
    () => sessionAuthorityRef.current.capture(),
    [],
  );

  const isCartSessionCurrent = useCallback(
    (ticket: CartSessionTicket) => sessionAuthorityRef.current.isCurrent(ticket),
    [],
  );

  const clearCartIfSession = useCallback(async (expected: CartSessionTicket) => {
    refreshGuardRef.current.invalidate();
    const cleared = await clearCartSessionIfCurrent({
      authority: sessionAuthorityRef.current,
      expected,
      removePersistedSession: () => storage.remove(SESSION_KEY),
      canCommit: () => mountedRef.current,
      resetDisplayState: resetCartDisplayState,
    });
    if (cleared) expiryHandledRef.current = false;
    return cleared;
  }, [resetCartDisplayState]);

  const applyCart = useCallback((response: Awaited<ReturnType<typeof cartService.get>>) => {
    const nextItems = getCartItems(response.cart);
    expiryHandledRef.current = false;
    setItems(nextItems);
    setTotal(Number(response.cart.total ?? 0));
    setCurrency(response.cart.currency ?? "USD");
    setExpiresAt(response.expires_at ? new Date(response.expires_at) : null);
    setCartRefreshError(null);
  }, []);

  const clearCart = useCallback(async () => {
    refreshGuardRef.current.invalidate();
    const expected = sessionAuthorityRef.current.capture();

    if (!expected) {
      await sessionAuthorityRef.current.enqueuePersistence(
        () => storage.remove(SESSION_KEY),
      );
      if (!mountedRef.current || sessionAuthorityRef.current.currentSessionId() !== null) return;
      expiryHandledRef.current = false;
      resetCartDisplayState();
      return;
    }

    const cleared = await clearCartSessionIfCurrent({
      authority: sessionAuthorityRef.current,
      expected,
      removePersistedSession: () => storage.remove(SESSION_KEY),
      canCommit: () => mountedRef.current,
      resetDisplayState: resetCartDisplayState,
    });
    if (cleared) expiryHandledRef.current = false;
  }, [resetCartDisplayState]);

  const expireCart = useCallback(async () => {
    if (expiryHandledRef.current) return;
    const expected = sessionAuthorityRef.current.capture();
    if (!expected) return;

    // A card payment is active (the CyberSource form is open or its result is
    // being submitted), or a card result that was never sent is held for this
    // session: the client timer must not destroy it. Deferred, not skipped:
    // the countdown calls this again every second, and the hold ends when the
    // card flow ends, its post-expiry grace period passes, or the held result
    // is sent or dropped with its session or authentication. The backend
    // still decides whether the reservation is valid for the submit.
    if (isCardFormOpen(expected.sessionId) || hasHeldCardResult(expected.sessionId)) {
      expiryDeferredForCardRef.current = expected.sessionId;
      return;
    }

    expiryHandledRef.current = true;
    refreshGuardRef.current.invalidate();
    // Captured before the clear destroys it (the clear also drops the pending BLUE request).
    const snapshot = expiredHoldFrom(
      itemsRef.current,
      Boolean(
        readPaymentOutcomeLock(expected.sessionId)
          || readPaymentAttempt(expected.sessionId)
          || readPendingBluePaymentAttempt(expected.sessionId ?? "")
          // A card form was open: it may have completed a payment just before the hold ended.
          || isCardFormOpen(expected.sessionId)
          // The expiry waited for a card payment: it may have gone through.
          || expiryDeferredForCardRef.current === expected.sessionId,
      ),
    );
    expiryDeferredForCardRef.current = null;
    const cleared = await clearCartSessionIfCurrent({
      authority: sessionAuthorityRef.current,
      expected,
      removePersistedSession: () => storage.remove(SESSION_KEY),
      canCommit: () => mountedRef.current,
      // Published in the same update as the clear, so screens never see an
      // empty cart without `expiredHold` (their empty-cart redirects stand down).
      resetDisplayState: () => {
        resetCartDisplayState();
        setExpiredHold(snapshot);
      },
    });
    if (!cleared) return;

    // Transaction screens (and any payment WebView) are dismissed; the v3
    // sheet is presented over Home by AppChrome.
    dismissEverythingAndGoHome();
  }, [resetCartDisplayState]);

  // This provider is the live cart owner for payment guards while mounted.
  // Unmounting retires it: a screen still holding this context can no longer
  // pass a card attempt or a session-lock write with its stale session.
  useEffect(() => registerCartOwner(() => sessionAuthorityRef.current.currentSessionId()), []);

  const dismissExpiredHold = useCallback(() => setExpiredHold(null), []);

  const refreshCartForSession = useCallback(async (expected: CartSessionTicket): Promise<CartPublication> => {
    if (
      expected.sessionId === null
      || !mountedRef.current
      || !sessionAuthorityRef.current.isCurrent(expected)
    ) return unconfirmedPublication("session-changed");

    const requestId = refreshGuardRef.current.begin();

    try {
      const response = await cartService.get(expected.sessionId);
      if (
        !mountedRef.current
        || !refreshGuardRef.current.isCurrent(requestId)
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return unconfirmedPublication("session-changed");

      const nextItems = getCartItems(response.cart);
      if (!nextItems.length) {
        // The backend reports an empty cart: clearing it is the published state.
        const cleared = await clearCartIfSession(expected);
        return cleared
          ? confirmedPublication<CartItem>(null, [])
          : unconfirmedPublication("session-changed");
      }

      let applied = false;
      await publishCartResponseIfCurrent(expected, response, () => {
        if (!refreshGuardRef.current.isCurrent(requestId)) return;
        applyCart(response);
        applied = true;
      });
      return applied
        ? confirmedPublication(expected.sessionId, nextItems)
        : unconfirmedPublication("session-changed");
    } catch (error) {
      if (
        !mountedRef.current
        || !refreshGuardRef.current.isCurrent(requestId)
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return unconfirmedPublication("session-changed");

      const status = error instanceof ApiError ? error.status : null;
      const failure = classifyCartRefreshFailure(status);
      if (failure.shouldClearSession) {
        await clearCartIfSession(expected);
        return unconfirmedPublication("session-ended");
      }

      setCartRefreshError(userFacingError(error, translate("cart.refreshFailed.detail")));
      return unconfirmedPublication("refresh-failed");
    }
  }, [applyCart, clearCartIfSession, publishCartResponseIfCurrent]);

  const refreshCart = useCallback((): Promise<CartPublication> => {
    const expected = sessionAuthorityRef.current.capture();
    // No session: the authoritative client cart is empty.
    if (!expected) {
      setReconciliation(releaseAfterRead(reconciliationRef.current, { confirmed: true, readSessionId: null }));
      return Promise.resolve(confirmedPublication<CartItem>(null, []));
    }

    return operationQueue.run(
      () => refreshCartForSession(expected),
      { trackLoading: false },
    ).then((result) => {
      // Only a confirmed read of the gated session releases the shared gate.
      setReconciliation(releaseAfterRead(reconciliationRef.current, {
        confirmed: result.confirmed,
        readSessionId: expected.sessionId,
      }));
      return result;
    });
  }, [operationQueue, refreshCartForSession, setReconciliation]);

  useEffect(() => {
    const refreshGuard = refreshGuardRef.current;
    mountedRef.current = true;
    void sessionAuthorityRef.current.enqueuePersistence(async () => {
      if (!auth.isReady || !auth.isAuthenticated) {
        await storage.remove(SESSION_KEY);
        await restorePaymentOutcomeLock(null);
        return;
      }
      const stored = await storage.get(SESSION_KEY);
      if (!mountedRef.current) return;

      const persisted = parsePersistedCartSession(stored, Date.now());

      if (persisted.kind === "malformed" || persisted.kind === "expired") {
        refreshGuard.invalidate();
        await storage.remove(SESSION_KEY);
        await restorePaymentOutcomeLock(null);
        if (mountedRef.current) resetCartState();
        return;
      }

      if (persisted.kind === "none") {
        await restorePaymentOutcomeLock(null);
        return;
      }

      if (persisted.kind === "active" || persisted.kind === "legacy") {
        // Restore this session's unknown-payment lock *before* publishing the
        // session, so no screen can see it payable in between.
        await restorePaymentOutcomeLock(persisted.sessionId);
        if (!mountedRef.current) return;
        sessionAuthorityRef.current.replace(persisted.sessionId);
        setSessionId(persisted.sessionId);
        if (persisted.kind === "active") setExpiresAt(new Date(persisted.expiresAt));
      }
    });
    return () => {
      mountedRef.current = false;
      refreshGuard.invalidate();
    };
  }, [auth.isReady, auth.isAuthenticated, resetCartState]);

  // The account whose unresolved card results gate payments. Its records are
  // read (and block until read) per account; signing out or switching
  // accounts never deletes them, and never shows one account another's.
  const paymentAccountId = auth.isReady && auth.isAuthenticated && auth.user ? String(auth.user.id) : null;
  const signedOut = auth.isReady && !auth.isAuthenticated;
  useEffect(() => {
    if (paymentAccountId !== null) void selectPaymentAccount(paymentAccountId);
    else if (signedOut) void selectPaymentAccount(null);
  }, [paymentAccountId, signedOut]);

  useEffect(() => {
    discardStaleCardPaymentRetry((snapshot, ticket) =>
      paymentAccountId !== null && isAuthenticationSnapshotCurrent(snapshot) && isCartSessionCurrent(ticket));
  }, [auth.userCacheKey, isCartSessionCurrent, paymentAccountId, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const timeout = setTimeout(() => void refreshCart(), 0);
    return () => clearTimeout(timeout);
  }, [refreshCart, sessionId]);

  useEffect(() => {
    const tick = () => {
      if (!expiresAt) {
        setSecondsLeft(0);
        return;
      }
      const next = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(next);
      if (next === 0) void expireCart();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expireCart, expiresAt]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && isCartExpiryReached(expiresAt, Date.now())) {
        void expireCart();
      }
    });
    return () => subscription.remove();
  }, [expireCart, expiresAt]);

  const addItem = useCallback((
    payload: Omit<AddCartRequest, "checkout_session_id">,
  ): Promise<CartPublication> => {
    if (!auth.isReady || !auth.isAuthenticated) { router.push("/auth"); return Promise.resolve(unconfirmedPublication("unauthenticated")); }
    if (isCartReconciliationRequired()) return Promise.resolve(unconfirmedPublication("reconciliation-required"));
    const expected = sessionAuthorityRef.current.captureCurrent();

    return addMutationGuardRef.current.run(
      () => operationQueue.run(() => trackOutcome(expected.sessionId, async (): Promise<CartPublication> => {
        if (
          !mountedRef.current
          || !sessionAuthorityRef.current.isCurrent(expected)
        ) return unconfirmedPublication("session-changed");
        if (isCartReconciliationRequired()) return unconfirmedPublication("reconciliation-required");

        const activeSessionId = expected.sessionId;
        const quantityToAdd = payload.quantity;
        const existingZoneItem =
          activeSessionId && quantityToAdd !== undefined && !payload.seat_ids?.length
            ? items.find(
              (item) =>
                item.type === "zone"
                && String(item.stadium_zone_id) === String(payload.stadium_zone_id)
                && String(item.match_id) === String(payload.match_id),
            )
            : null;

        if (existingZoneItem && quantityToAdd !== undefined) {
          const currentQuantity = Number(existingZoneItem.quantity ?? 0);
          const response = await cartService.update(existingZoneItem.lock_key, {
            quantity: currentQuantity + quantityToAdd,
          });

          const published = await publishCartResponseIfCurrent(expected, response, () => {
            if (response.checkout_session_id !== expected.sessionId) {
              sessionAuthorityRef.current.replace(response.checkout_session_id);
              setSessionId(response.checkout_session_id);
            }
            applyCart(response);
          });
          return published
            ? confirmedPublication(response.checkout_session_id, getCartItems(response.cart))
            : unconfirmedPublication("session-changed");
        }

        let publicationOwner: CartSessionTicket | null = expected;
        const response = await addWithSessionRecovery({
          payload,
          sessionId: activeSessionId,
          add: (request) => cartService.add(request),
          getStatus: (error) => error instanceof ApiError ? error.status : null,
          invalidateRejectedSession: async (rejectedSessionId) => {
            if (
              expected.sessionId !== rejectedSessionId
              || !sessionAuthorityRef.current.isCurrent(expected)
            ) {
              publicationOwner = null;
              return;
            }

            refreshGuardRef.current.invalidate();
            resetCartState();
            const recoveryOwner = sessionAuthorityRef.current.captureCurrent();
            publicationOwner = recoveryOwner;

            try {
              await sessionAuthorityRef.current.enqueuePersistence(
                () => storage.remove(SESSION_KEY),
              );
            } catch {
              // The rejected ID remains invalid in memory; a successful bootstrap overwrites persistence below.
            }

            if (!sessionAuthorityRef.current.isCurrent(recoveryOwner)) {
              publicationOwner = null;
            }
          },
        });

        if (!publicationOwner) return unconfirmedPublication("session-changed");

        const published = await publishCartResponseIfCurrent(publicationOwner, response, () => {
          if (response.checkout_session_id !== publicationOwner?.sessionId) {
            sessionAuthorityRef.current.replace(response.checkout_session_id);
            setSessionId(response.checkout_session_id);
          }
          applyCart(response);
        });
        return published
          ? confirmedPublication(response.checkout_session_id, getCartItems(response.cart))
          : unconfirmedPublication("session-changed");
      })),
    );
  }, [auth.isReady, auth.isAuthenticated, applyCart, isCartReconciliationRequired, items, operationQueue, publishCartResponseIfCurrent, resetCartState, trackOutcome]);

  const removeItem = useCallback((lockKey: string): Promise<CartPublication> => {
    const expected = sessionAuthorityRef.current.capture();
    if (!expected) return Promise.resolve(unconfirmedPublication("session-changed"));
    if (isCartReconciliationRequired()) return Promise.resolve(unconfirmedPublication("reconciliation-required"));

    return operationQueue.run(() => trackOutcome(expected.sessionId, async (): Promise<CartPublication> => {
      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return unconfirmedPublication("session-changed");
      if (isCartReconciliationRequired()) return unconfirmedPublication("reconciliation-required");

      await cartService.remove(lockKey);

      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return unconfirmedPublication("session-changed");

      // The delete is only confirmed by the refresh that publishes the resulting cart.
      return refreshCartForSession(expected);
    }));
  }, [isCartReconciliationRequired, operationQueue, refreshCartForSession, trackOutcome]);

  const removeItems = useCallback((lockKeys: string[]): Promise<CartRemovalResult> => {
    const expected = sessionAuthorityRef.current.capture();
    if (!expected || !lockKeys.length) return Promise.resolve({ status: "notPerformed", reason: "no-session" });
    if (isCartReconciliationRequired()) {
      return Promise.resolve({ status: "notPerformed", reason: "reconciliation-required" });
    }

    // The sequence lives in cartReconciliation.ts (runGroupedRemoval) so each
    // outcome can be tested deterministically; it runs inside the same queue.
    return operationQueue.run(() => runGroupedRemoval({
      lockKeys,
      sessionId: expected.sessionId,
      isSessionCurrent: () => mountedRef.current && sessionAuthorityRef.current.isCurrent(expected),
      isGateActive: isCartReconciliationRequired,
      remove: (lockKey) => cartService.remove(lockKey),
      refresh: () => refreshCartForSession(expected),
      raiseGate,
      factsOf: errorFacts,
    }));
  }, [isCartReconciliationRequired, operationQueue, raiseGate, refreshCartForSession]);

  const updateItem = useCallback((lockKey: string, quantity: number): Promise<CartPublication> => {
    if (quantity < 1) return removeItem(lockKey);

    const expected = sessionAuthorityRef.current.capture();
    if (!expected) return Promise.resolve(unconfirmedPublication("session-changed"));
    if (isCartReconciliationRequired()) return Promise.resolve(unconfirmedPublication("reconciliation-required"));

    return operationQueue.run(() => trackOutcome(expected.sessionId, async (): Promise<CartPublication> => {
      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return unconfirmedPublication("session-changed");
      if (isCartReconciliationRequired()) return unconfirmedPublication("reconciliation-required");

      const response = await cartService.update(lockKey, { quantity });

      const published = await publishCartResponseIfCurrent(expected, response, () => {
        if (response.checkout_session_id !== expected.sessionId) {
          sessionAuthorityRef.current.replace(response.checkout_session_id);
          setSessionId(response.checkout_session_id);
        }
        applyCart(response);
      });
      return published
        ? confirmedPublication(response.checkout_session_id, getCartItems(response.cart))
        : unconfirmedPublication("session-changed");
    }));
  }, [applyCart, isCartReconciliationRequired, operationQueue, publishCartResponseIfCurrent, removeItem, trackOutcome]);

  const value = useMemo(() => ({
    sessionId,
    items,
    total,
    currency,
    secondsLeft,
    isLoading,
    cartRefreshError,
    addItem,
    removeItem,
    removeItems,
    updateItem,
    refreshCart,
    cartReconciliation,
    isCartReconciliationRequired,
    requireCartReconciliation,
    readCartGuardState,
    clearCart,
    captureCartSession,
    isCartSessionCurrent,
    clearCartIfSession,
    expiredHold,
    dismissExpiredHold,
  }), [
    addItem,
    captureCartSession,
    cartReconciliation,
    cartRefreshError,
    clearCart,
    clearCartIfSession,
    isCartReconciliationRequired,
    readCartGuardState,
    requireCartReconciliation,
    currency,
    isCartSessionCurrent,
    isLoading,
    items,
    refreshCart,
    removeItem,
    removeItems,
    secondsLeft,
    sessionId,
    total,
    updateItem,
    dismissExpiredHold,
    expiredHold,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
