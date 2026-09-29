import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { reservationJustExpired, type ReservationSnapshot } from "@/lib/cartPresentation";
import { useEffect, useRef } from "react";

/**
 * Explains the owner's expiry. `CartContext` clears an expired reservation and
 * resets navigation to Home; without this the user would not know why their
 * tickets disappeared. It observes the owner's published state only and
 * renders nothing: it never extends, clears or re-creates a reservation.
 */
export function ReservationExpiryNotice() {
  const cart = useCart();
  const toast = useToast();
  const i18n = useI18n();
  const previousRef = useRef<ReservationSnapshot | null>(null);
  const sessionId = cart.sessionId;
  const secondsLeft = cart.secondsLeft;
  const itemCount = cart.items.length;

  useEffect(() => {
    const next = { sessionId, secondsLeft, itemCount };
    const expired = reservationJustExpired(previousRef.current, next);
    previousRef.current = next;
    if (!expired) return;
    toast.showToast({
      variant: "warning",
      title: i18n.t("cart.expiredNotice.title"),
      message: i18n.t("cart.expiredNotice.message"),
    });
  }, [i18n, itemCount, secondsLeft, sessionId, toast]);

  return null;
}
