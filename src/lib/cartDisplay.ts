import type { CartItem } from "@/types";

export type CartDisplayItem = {
  key: string;
  lockKeys: string[];
  match_id: string;
  stadium_zone_id: string;
  zone_name?: string;
  match_title?: string;
  quantity: number;
  seats: NonNullable<CartItem["seats"]>;
  unit_price: number;
  currency: string;
  subtotal: number;
};

/**
 * Display amount from the backend value. A missing or non-numeric price stays
 * NaN (formatMoney shows "Price unavailable") and poisons any sum; it is never
 * coerced to 0, which would look like a genuine free ticket.
 */
function displayAmount(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function itemQuantity(item: CartItem) {
  const seatCount = item.seats?.length ?? 0;
  return Number(item.quantity ?? (seatCount || 0));
}

export function groupCartItems(items: CartItem[]): CartDisplayItem[] {
  const groups = new Map<string, CartDisplayItem>();

  items.forEach((item) => {
    const key = [
      item.match_id,
      item.stadium_zone_id,
      item.zone_name ?? "Ticket",
      item.unit_price,
      item.currency,
    ].join("|");
    const current = groups.get(key);
    const seats = item.seats ?? [];

    if (current) {
      current.lockKeys.push(item.lock_key);
      current.quantity += itemQuantity(item);
      current.seats.push(...seats);
      current.subtotal += displayAmount(item.subtotal);
      return;
    }

    groups.set(key, {
      key,
      lockKeys: [item.lock_key],
      match_id: String(item.match_id),
      stadium_zone_id: String(item.stadium_zone_id),
      zone_name: item.zone_name,
      match_title: item.match_title,
      quantity: itemQuantity(item),
      seats: [...seats],
      unit_price: displayAmount(item.unit_price),
      currency: item.currency,
      subtotal: displayAmount(item.subtotal),
    });
  });

  return Array.from(groups.values());
}
