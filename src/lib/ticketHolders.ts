import { translate } from "../i18n/runtime.ts";
import type { CartItem } from "@/types";

export type TicketSlot = {
  key: string;
  matchId: string;
  matchTitle?: string;
  zoneName: string;
  label: string;
};

/**
 * One slot per physical ticket/seat in the cart — the exact same key scheme
 * (`${lock_key}_seat_${seatId}` / `${lock_key}_ticket_${index}`) the checkout
 * screen has always used to key holder names, so existing/edited holder
 * names line up whether the cart changed between screens or not.
 */
export function deriveTicketSlots(items: CartItem[], t: typeof translate = translate): TicketSlot[] {
  return items.flatMap((item) => {
    const matchId = String(item.match_id);
    const zoneName = item.zone_name ?? t("cart.zoneFallback");
    const matchTitle = item.match_title;

    if (item.seats?.length) {
      return item.seats.map((seat) => ({
        key: `${item.lock_key}_seat_${seat.id}`,
        matchId,
        matchTitle,
        zoneName,
        label: `${zoneName} - ${t("seat.number", { number: seat.label ?? `${seat.row}${seat.number}` })}`,
      }));
    }

    return Array.from({ length: Number(item.quantity ?? 1) }, (_, index) => ({
      key: `${item.lock_key}_ticket_${index}`,
      matchId,
      matchTitle,
      zoneName,
      label: `${zoneName} - ${t("holders.ticketNumber", { number: index + 1 })}`,
    }));
  });
}
