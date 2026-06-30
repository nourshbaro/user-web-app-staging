import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { storage } from "@/lib/storage";
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
  addItem: (payload: Omit<AddCartRequest, "checkout_session_id">) => Promise<void>;
  removeItem: (lockKey: string) => Promise<void>;
  removeItems: (lockKeys: string[]) => Promise<void>;
  updateItem: (lockKey: string, quantity: number) => Promise<void>;
  refreshCart: () => Promise<void>;
  clearCart: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: PropsWithChildren) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currency, setCurrency] = useState("USD");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isLoading, setLoading] = useState(false);

  const applyCart = (response: Awaited<ReturnType<typeof cartService.get>>) => {
    const nextItems = getCartItems(response.cart);
    setItems(nextItems);
    setTotal(Number(response.cart.total ?? 0));
    setCurrency(response.cart.currency ?? "USD");
    setExpiresAt(response.expires_at ? new Date(response.expires_at) : null);
  };

  const clearCart = async () => {
    await storage.remove(SESSION_KEY);
    setSessionId(null);
    setExpiresAt(null);
    setItems([]);
    setTotal(0);
    setSecondsLeft(0);
  };

  const refreshCart = async () => {
    if (!sessionId) return;
    try {
      const response = await cartService.get(sessionId);
      const nextItems = getCartItems(response.cart);
      if (!nextItems.length) {
        await clearCart();
        return;
      }
      applyCart(response);
    } catch {
      await clearCart();
    }
  };

  useEffect(() => {
    void storage.get(SESSION_KEY).then((stored) => {
      if (stored) setSessionId(stored);
    });
  }, []);

  useEffect(() => {
    if (sessionId) void refreshCart();
  }, [sessionId]);

  useEffect(() => {
    const tick = () => {
      if (!expiresAt) {
        setSecondsLeft(0);
        return;
      }
      const next = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setSecondsLeft(next);
      if (next === 0) void clearCart();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const addItem = async (payload: Omit<AddCartRequest, "checkout_session_id">) => {
    setLoading(true);
    try {
      const quantityToAdd = payload.quantity;
      const existingZoneItem =
        sessionId && quantityToAdd !== undefined && !payload.seat_ids?.length
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

      const response = await cartService.add(sessionId ? { ...payload, checkout_session_id: sessionId } : payload);
      if (!sessionId) {
        await storage.set(SESSION_KEY, response.checkout_session_id);
        setSessionId(response.checkout_session_id);
      }
      applyCart(response);
    } finally {
      setLoading(false);
    }
  };

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
    addItem,
    removeItem,
    removeItems,
    updateItem,
    refreshCart,
    clearCart,
  }), [currency, isLoading, items, secondsLeft, sessionId, total]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}
