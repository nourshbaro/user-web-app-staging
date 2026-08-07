import { router } from "expo-router";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { classifyCartRefreshFailure, createCartRefreshGuard } from "@/lib/cartRefreshPolicy";
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
  const sessionIdRef = useRef<string | null>(null);

  const resetCartState = useCallback(() => {
    sessionIdRef.current = null;
    setSessionId(null);
    setExpiresAt(null);
    setItems([]);
    setTotal(0);
    setCurrency("USD");
    setSecondsLeft(0);
    setCartRefreshError(null);
  }, []);

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
    await storage.remove(SESSION_KEY);
    if (!mountedRef.current) return;
    expiryHandledRef.current = false;
    resetCartState();
  }, [resetCartState]);

  const expireCart = useCallback(async () => {
    if (expiryHandledRef.current) return;
    expiryHandledRef.current = true;
    refreshGuardRef.current.invalidate();
    await storage.remove(SESSION_KEY);
    if (!mountedRef.current) return;
    resetCartState();
    dismissEverythingAndGoHome();
  }, [resetCartState]);

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
  }, [applyCart, clearCart, sessionId]);

  useEffect(() => {
    const refreshGuard = refreshGuardRef.current;
    mountedRef.current = true;
    void storage.get(SESSION_KEY).then((stored) => {
      if (mountedRef.current && stored) {
        sessionIdRef.current = stored;
        setSessionId(stored);
      }
    });
    return () => {
      mountedRef.current = false;
      refreshGuard.invalidate();
    };
  }, []);

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

  const addItem = (payload: Omit<AddCartRequest, "checkout_session_id">) => addMutationGuardRef.current.run(async () => {
    setLoading(true);
    try {
      const activeSessionId = sessionIdRef.current;
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
        applyCart(response);
        return;
      }

      const response = await addWithSessionRecovery({
        payload,
        sessionId: activeSessionId,
        add: (request) => cartService.add(request),
        getStatus: (error) => error instanceof ApiError ? error.status : null,
        invalidateRejectedSession: async (rejectedSessionId) => {
          if (sessionIdRef.current === rejectedSessionId) {
            refreshGuardRef.current.invalidate();
            sessionIdRef.current = null;
            resetCartState();
          }
          try {
            await storage.remove(SESSION_KEY);
          } catch {
            // The rejected ID remains invalid in memory; a successful bootstrap overwrites persistence below.
          }
        },
      });
      if (!activeSessionId || response.checkout_session_id !== activeSessionId) {
        await storage.set(SESSION_KEY, response.checkout_session_id);
        sessionIdRef.current = response.checkout_session_id;
        setSessionId(response.checkout_session_id);
      }
      applyCart(response);
    } finally {
      setLoading(false);
    }
  });

  const removeItem = async (lockKey: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await cartService.remove(lockKey);
      await refreshCart();
    } finally {
      setLoading(false);
    }
  };

  const removeItems = async (lockKeys: string[]) => {
    if (!sessionId || !lockKeys.length) return;
    setLoading(true);
    try {
      await Promise.all(lockKeys.map((lockKey) => cartService.remove(lockKey)));
      await refreshCart();
    } finally {
      setLoading(false);
    }
  };

  const updateItem = async (lockKey: string, quantity: number) => {
    if (quantity < 1) return removeItem(lockKey);
    setLoading(true);
    try {
      const response = await cartService.update(lockKey, { quantity });
      applyCart(response);
    } finally {
      setLoading(false);
    }
  };

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
  }), [cartRefreshError, currency, isLoading, items, secondsLeft, sessionId, total]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
