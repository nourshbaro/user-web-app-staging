import { apiRequest, unwrapData } from "@/services/api";
import type { AddCartRequest, CartItem, CartResponse, UpdateCartRequest } from "@/types";

function titleFromMatch(match?: { home_team?: string; away_team?: string }) {
  return match?.home_team && match?.away_team ? `${match.home_team} vs ${match.away_team}` : undefined;
}

export function getCartItems(cart?: CartResponse["cart"]): CartItem[] {
  if (!cart) return [];
  if (Array.isArray(cart.items) && cart.items.length) return cart.items;
  return (cart.matches ?? []).flatMap((match) =>
    (match.items ?? []).map((item) => ({
      ...item,
      match_id: String(item.match_id ?? match.match_id),
      match_title: item.match_title ?? titleFromMatch(match.match_info),
    })),
  );
}

function normalize(payload: unknown): CartResponse {
  const candidate = unwrapData(payload as CartResponse | { data: CartResponse });
  if (!candidate?.cart || !candidate.checkout_session_id) throw new Error("Unexpected cart response.");
  return {
    ...candidate,
    cart: {
      ...candidate.cart,
      total: Number(candidate.cart.total ?? 0),
      currency: candidate.cart.currency ?? "USD",
      items: getCartItems(candidate.cart),
    },
  };
}

export const cartService = {
  async add(data: AddCartRequest) {
    return normalize(await apiRequest("/cart/items", { method: "POST", body: JSON.stringify(data) }));
  },

  async get(sessionId: string) {
    return normalize(await apiRequest(`/cart?checkout_session_id=${encodeURIComponent(sessionId)}`));
  },

  async update(lockKey: string, payload: UpdateCartRequest) {
    return normalize(await apiRequest(`/cart/items/${encodeURIComponent(lockKey)}`, { method: "PATCH", body: JSON.stringify(payload) }));
  },

  async remove(lockKey: string) {
    await apiRequest(`/cart/items/${encodeURIComponent(lockKey)}`, { method: "DELETE" });
  },
};
