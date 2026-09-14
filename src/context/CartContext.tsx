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
import { createCartOperationQueue } from "@/lib/cartOperationQueue";
import {
  clearPendingBluePaymentAttempt,
  invalidatePendingBluePaymentAttemptUnlessSession,
} from "@/lib/bluePaymentHandoff";
import {
  clearCartSessionIfCurrent,
  createCartSessionAuthority,
  publishCartSessionIfCurrent,
  type CartSessionTicket,
} from "@/lib/cartSessionAuthority";
import { addWithSessionRecovery, createSingleFlight } from "@/lib/cartSessionRecovery";
import { storage } from "@/lib/storage";
import { userFacingError } from "@/lib/userFacingError";
import { ApiError } from "@/services/api";
import { cartService, getCartItems } from "@/services/cart";
import type { AddCartRequest, CartItem } from "@/types";

const SESSION_KEY = "lfa_cart_session_id";

type CartContextValue = {
  sessionId: string | null;
  items: CartItem[];
  total: number;
  currency: string;
  secondsLeft: number;
  isLoading: boolean;
  cartRefreshError: string | null;
  addItem: (payload: Omit<AddCartRequest, "checkout_session_id">) => Promise<void>;
  removeItem: (lockKey: string) => Promise<void>;
  removeItems: (lockKeys: string[]) => Promise<void>;
  updateItem: (lockKey: string, quantity: number) => Promise<void>;
  refreshCart: () => Promise<void>;
  clearCart: () => Promise<void>;
  captureCartSession: () => CartSessionTicket | null;
  isCartSessionCurrent: (ticket: CartSessionTicket) => boolean;
  clearCartIfSession: (ticket: CartSessionTicket) => Promise<CartSessionTicket | null>;
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
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isLoading, setLoading] = useState(false);
  const [cartRefreshError, setCartRefreshError] = useState<string | null>(null);
  const expiryHandledRef = useRef(false);
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
    setSessionId(null);
    setExpiresAt(null);
    setItems([]);
    setTotal(0);
    setCurrency("USD");
    setSecondsLeft(0);
    setCartRefreshError(null);
  }, []);

  useEffect(() => {
    invalidatePendingBluePaymentAttemptUnlessSession(sessionId);
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

    expiryHandledRef.current = true;
    refreshGuardRef.current.invalidate();
    const cleared = await clearCartSessionIfCurrent({
      authority: sessionAuthorityRef.current,
      expected,
      removePersistedSession: () => storage.remove(SESSION_KEY),
      canCommit: () => mountedRef.current,
      resetDisplayState: resetCartDisplayState,
    });
    if (!cleared) return;

    dismissEverythingAndGoHome();
  }, [resetCartDisplayState]);

  const refreshCartForSession = useCallback(async (expected: CartSessionTicket) => {
    if (
      expected.sessionId === null
      || !mountedRef.current
      || !sessionAuthorityRef.current.isCurrent(expected)
    ) return;

    const requestId = refreshGuardRef.current.begin();

    try {
      const response = await cartService.get(expected.sessionId);
      if (
        !mountedRef.current
        || !refreshGuardRef.current.isCurrent(requestId)
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return;

      const nextItems = getCartItems(response.cart);
      if (!nextItems.length) {
        await clearCartIfSession(expected);
        return;
      }

      await publishCartResponseIfCurrent(expected, response, () => {
        if (!refreshGuardRef.current.isCurrent(requestId)) return;
        applyCart(response);
      });
    } catch (error) {
      if (
        !mountedRef.current
        || !refreshGuardRef.current.isCurrent(requestId)
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return;

      const status = error instanceof ApiError ? error.status : null;
      const failure = classifyCartRefreshFailure(status);
      if (failure.shouldClearSession) {
        await clearCartIfSession(expected);
        return;
      }

      setCartRefreshError(userFacingError(error, "We couldn't refresh your cart. Your reservation reference was kept; please try again."));
    }
  }, [applyCart, clearCartIfSession, publishCartResponseIfCurrent]);

  const refreshCart = useCallback(() => {
    const expected = sessionAuthorityRef.current.capture();
    if (!expected) return Promise.resolve();

    return operationQueue.run(
      () => refreshCartForSession(expected),
      { trackLoading: false },
    );
  }, [operationQueue, refreshCartForSession]);

  useEffect(() => {
    const refreshGuard = refreshGuardRef.current;
    mountedRef.current = true;
    void sessionAuthorityRef.current.enqueuePersistence(async () => {
      if (!auth.isReady || !auth.isAuthenticated) {
        await storage.remove(SESSION_KEY);
        return;
      }
      const stored = await storage.get(SESSION_KEY);
      if (!mountedRef.current) return;

      const persisted = parsePersistedCartSession(stored, Date.now());

      if (persisted.kind === "malformed" || persisted.kind === "expired") {
        refreshGuard.invalidate();
        await storage.remove(SESSION_KEY);
        if (mountedRef.current) resetCartState();
        return;
      }

      if (persisted.kind === "active" || persisted.kind === "legacy") {
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
  ) => {
    if (!auth.isReady || !auth.isAuthenticated) { router.push("/auth"); return Promise.resolve(); }
    const expected = sessionAuthorityRef.current.captureCurrent();

    return addMutationGuardRef.current.run(
      () => operationQueue.run(async () => {
        if (
          !mountedRef.current
          || !sessionAuthorityRef.current.isCurrent(expected)
        ) return;

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

          await publishCartResponseIfCurrent(expected, response, () => {
            if (response.checkout_session_id !== expected.sessionId) {
              sessionAuthorityRef.current.replace(response.checkout_session_id);
              setSessionId(response.checkout_session_id);
            }
            applyCart(response);
          });
          return;
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

        if (!publicationOwner) return;

        await publishCartResponseIfCurrent(publicationOwner, response, () => {
          if (response.checkout_session_id !== publicationOwner?.sessionId) {
            sessionAuthorityRef.current.replace(response.checkout_session_id);
            setSessionId(response.checkout_session_id);
          }
          applyCart(response);
        });
      }),
    );
  }, [auth.isReady, auth.isAuthenticated, applyCart, items, operationQueue, publishCartResponseIfCurrent, resetCartState]);

  const removeItem = useCallback((lockKey: string) => {
    const expected = sessionAuthorityRef.current.capture();
    if (!expected) return Promise.resolve();

    return operationQueue.run(async () => {
      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return;

      await cartService.remove(lockKey);

      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return;

      await refreshCartForSession(expected);
    });
  }, [operationQueue, refreshCartForSession]);

  const removeItems = useCallback((lockKeys: string[]) => {
    const expected = sessionAuthorityRef.current.capture();
    if (!expected || !lockKeys.length) return Promise.resolve();

    return operationQueue.run(async () => {
      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return;

      await Promise.all(
        lockKeys.map((lockKey) => cartService.remove(lockKey)),
      );

      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return;

      await refreshCartForSession(expected);
    });
  }, [operationQueue, refreshCartForSession]);

  const updateItem = useCallback((lockKey: string, quantity: number) => {
    if (quantity < 1) return removeItem(lockKey);

    const expected = sessionAuthorityRef.current.capture();
    if (!expected) return Promise.resolve();

    return operationQueue.run(async () => {
      if (
        !mountedRef.current
        || !sessionAuthorityRef.current.isCurrent(expected)
      ) return;

      const response = await cartService.update(lockKey, { quantity });

      await publishCartResponseIfCurrent(expected, response, () => {
        if (response.checkout_session_id !== expected.sessionId) {
          sessionAuthorityRef.current.replace(response.checkout_session_id);
          setSessionId(response.checkout_session_id);
        }
        applyCart(response);
      });
    });
  }, [applyCart, operationQueue, publishCartResponseIfCurrent, removeItem]);

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
    clearCart,
    captureCartSession,
    isCartSessionCurrent,
    clearCartIfSession,
  }), [
    addItem,
    captureCartSession,
    cartRefreshError,
    clearCart,
    clearCartIfSession,
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
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
