import { router } from "expo-router";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Keyboard, Platform } from "react-native";
import {
  isCartExpiryReached,
  parsePersistedCartSession,
  serializePersistedCartSession,
} from "@/lib/cartPersistence";
import { classifyCartRefreshFailure, createCartRefreshGuard } from "@/lib/cartRefreshPolicy";
import {
  clearCartSessionIfCurrent,
  createCartSessionAuthority,
  type CartSessionTicket,
} from "@/lib/cartSessionAuthority";
import { addWithSessionRecovery, createSingleFlight } from "@/lib/cartSessionRecovery";
import { storage } from "@/lib/storage";
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

  const persistAuthoritativeCartSession = useCallback(
    (response: Awaited<ReturnType<typeof cartService.get>>) => {
      const persisted = serializePersistedCartSession(response.checkout_session_id, response.expires_at);
      return sessionAuthorityRef.current.enqueuePersistence(
        () => persisted ? storage.set(SESSION_KEY, persisted) : storage.remove(SESSION_KEY)
      )
    },
    [],
  );

  const resetCartDisplayState = useCallback(() => {
    setSessionId(null);
    setExpiresAt(null);
    setItems([]);
    setTotal(0);
    setCurrency("USD");
    setSecondsLeft(0);
    setCartRefreshError(null);
  }, []);

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

  const refreshCart = useCallback(async () => {
    if (!sessionId) return;
    const requestId = refreshGuardRef.current.begin();
    try {
      const response = await cartService.get(sessionId);
      if (!mountedRef.current || !refreshGuardRef.current.isCurrent(requestId)) return;
      const nextItems = getCartItems(response.cart);
      if (!nextItems.length) {
        await clearCart();
        return;
      }
      await persistAuthoritativeCartSession(response);
      if (!mountedRef.current || !refreshGuardRef.current.isCurrent(requestId)) return;
      applyCart(response);
    } catch (error) {
      if (!mountedRef.current || !refreshGuardRef.current.isCurrent(requestId)) return;
      const status = error instanceof ApiError ? error.status : null;
      const failure = classifyCartRefreshFailure(status);
      if (failure.shouldClearSession) {
        await clearCart();
        return;
      }
      setCartRefreshError("We couldn't refresh your cart. Your reservation reference was kept; please try again.");
    }
  }, [applyCart, clearCart, persistAuthoritativeCartSession, sessionId]);

  useEffect(() => {
    const refreshGuard = refreshGuardRef.current;
    mountedRef.current = true;
    void sessionAuthorityRef.current
      .enqueuePersistence(() => storage.get(SESSION_KEY))
      .then(async (stored) => {
        if (!mountedRef.current) return;
        const persisted = parsePersistedCartSession(stored, Date.now());

        if (persisted.kind === "malformed" || persisted.kind === "expired") {
          refreshGuard.invalidate();
          await sessionAuthorityRef.current.enqueuePersistence(
            () => storage.remove(SESSION_KEY),
          );
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
  }, [resetCartState]);

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

  const addItem = useCallback((payload: Omit<AddCartRequest, "checkout_session_id">) => addMutationGuardRef.current.run(async () => {
    setLoading(true);
    try {
      const activeSessionId = sessionAuthorityRef.current.currentSessionId();
      const quantityToAdd = payload.quantity;
      const existingZoneItem =
        activeSessionId && quantityToAdd !== undefined && !payload.seat_ids?.length
          ? items.find(
            (item) =>
              item.type === "zone" &&
              String(item.stadium_zone_id) === String(payload.stadium_zone_id) &&
              String(item.match_id) === String(payload.match_id),
          )
          : null;

      if (existingZoneItem && quantityToAdd !== undefined) {
        const currentQuantity = Number(existingZoneItem.quantity ?? 0);
        const response = await cartService.update(existingZoneItem.lock_key, { quantity: currentQuantity + quantityToAdd });
        await persistAuthoritativeCartSession(response);
        applyCart(response);
        return;
      }

      const response = await addWithSessionRecovery({
        payload,
        sessionId: activeSessionId,
        add: (request) => cartService.add(request),
        getStatus: (error) => error instanceof ApiError ? error.status : null,
        invalidateRejectedSession: async (rejectedSessionId) => {
          if (sessionAuthorityRef.current.currentSessionId() === rejectedSessionId) {
            refreshGuardRef.current.invalidate();
            resetCartState();
          }
          try {
            await sessionAuthorityRef.current.enqueuePersistence(
              () => storage.remove(SESSION_KEY),
            );
          } catch {
            // The rejected ID remains invalid in memory; a successful bootstrap overwrites persistence below.
          }
        },
      });
      await persistAuthoritativeCartSession(response);
      if (!activeSessionId || response.checkout_session_id !== activeSessionId) {
        sessionAuthorityRef.current.replace(response.checkout_session_id);
        setSessionId(response.checkout_session_id);
      }
      applyCart(response);
    } finally {
      setLoading(false);
    }
  }), [applyCart, items, persistAuthoritativeCartSession, resetCartState]);

  const removeItem = useCallback(async (lockKey: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await cartService.remove(lockKey);
      await refreshCart();
    } finally {
      setLoading(false);
    }
  }, [refreshCart, sessionId]);

  const removeItems = useCallback(async (lockKeys: string[]) => {
    if (!sessionId || !lockKeys.length) return;
    setLoading(true);
    try {
      await Promise.all(lockKeys.map((lockKey) => cartService.remove(lockKey)));
      await refreshCart();
    } finally {
      setLoading(false);
    }
  }, [refreshCart, sessionId]);

  const updateItem = useCallback(async (lockKey: string, quantity: number) => {
    if (quantity < 1) return removeItem(lockKey);
    setLoading(true);
    try {
      const response = await cartService.update(lockKey, { quantity });
      await persistAuthoritativeCartSession(response);
      applyCart(response);
    } finally {
      setLoading(false);
    }
  }, [applyCart, persistAuthoritativeCartSession, removeItem]);

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
