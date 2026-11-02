import { useAlertDialog } from "@/context/AlertDialogContext";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { errorFacts } from "@/lib/apiErrorFacts";
import type { CartDisplayItem } from "@/lib/cartDisplay";
import { quantityChangeConfirmed, removalConfirmed } from "@/lib/cartPresentation";
import { reconciliationActive, remainingLockKeys } from "@/lib/cartReconciliation";
import { failureNeedsReconcile, ticketErrorKind } from "@/lib/ticketSelection";
import { reasonWithGuidance, userFacingError } from "@/lib/userFacingError";
import { useState } from "react";

/**
 * Screen-level actions for one cart line (quantity and removal), shared by
 * the Cart screen and the cart sheet. It holds only which line is busy.
 *
 * The "re-read the cart first" gate is NOT held here: it is the shared
 * `CartContext.cartReconciliation`, so an unknown outcome on one surface
 * blocks every surface (Match Details, Cart, cart sheet, Checkout, payment)
 * until a confirmed refresh of that session. A resolved mutation is never
 * treated as success: quantity changes are judged by the returned
 * `CartPublication`, removals by the explicit `CartRemovalResult`.
 */
export function useCartLineActions() {
  const cart = useCart();
  const toast = useToast();
  const alertDialog = useAlertDialog();
  const i18n = useI18n();
  const [pendingLineKey, setPendingLineKey] = useState<string | null>(null);
  const [checkingCart, setCheckingCart] = useState(false);
  // Rendered from the owner state; handlers re-check synchronously.
  const needsCartCheck = reconciliationActive(cart.cartReconciliation, cart.sessionId);
  const busy = pendingLineKey !== null || checkingCart;

  const currentSession = () => cart.captureCartSession()?.sessionId ?? null;

  // `error`: the failed request, whose reason precedes the re-check guidance.
  const reportUnconfirmed = (error?: unknown) => {
    toast.showToast({
      variant: "warning",
      title: i18n.t("cart.unconfirmed.title"),
      message: reasonWithGuidance(error, i18n.t("cart.unconfirmed.message")),
    });
  };

  const reportFailure = (error: unknown) => {
    const kind = ticketErrorKind("cart", errorFacts(error));
    // The owner has already raised the shared gate for an ambiguous failure.
    if (failureNeedsReconcile(kind)) {
      reportUnconfirmed(error);
      return;
    }
    toast.showToast({
      variant: "error",
      title: i18n.t("cart.actionFailed.title"),
      message: userFacingError(
        error,
        kind === "session"
          ? i18n.t("ticketError.session")
          : kind === "expired"
            ? i18n.t("ticketError.expired")
            : kind === "unavailable"
              ? i18n.t("ticketError.unavailable")
              : kind === "rejected"
                ? i18n.t("ticketError.rejected")
                : i18n.t("ticketError.cart"),
      ),
    });
  };

  const setQuantity = async (line: CartDisplayItem, quantity: number) => {
    const lockKey = line.lockKeys[0];
    if (busy || cart.isCartReconciliationRequired() || !lockKey || quantity < 1 || quantity === line.quantity) return;
    const startedInSession = currentSession();
    setPendingLineKey(line.key);
    try {
      const publication = await cart.updateItem(lockKey, quantity);
      const confirmed = quantityChangeConfirmed(publication, {
        lockKey,
        quantity,
        startedInSession,
        currentSession: currentSession(),
      });
      if (confirmed) return;
      // A published cart that does not show the change, or no publication at
      // all: the outcome is unknown, so every surface must re-read first.
      if (!(publication.confirmed === false && publication.reason === "session-changed")) {
        cart.requireCartReconciliation("unconfirmed-mutation");
      }
      reportUnconfirmed();
    } catch (error) {
      reportFailure(error);
    } finally {
      setPendingLineKey(null);
    }
  };

  const removeLine = async (line: CartDisplayItem, zoneName: string) => {
    if (busy || cart.isCartReconciliationRequired()) return;
    const confirmedByUser = await alertDialog.showAlert({
      title: i18n.t("cart.remove.confirm.title"),
      message: i18n.t("cart.remove.confirm.message", { zone: zoneName }),
      variant: "destructive",
      cancelLabel: i18n.t("cart.remove.confirm.cancel"),
      confirmLabel: i18n.t("cart.remove.confirm.action"),
    });
    if (!confirmedByUser) return;
    // The plan is always regenerated from the current published cart, so a
    // retry after reconciliation only targets lines that are still reserved.
    const lockKeys = remainingLockKeys(line.lockKeys, cart.items);
    if (!lockKeys.length) return;
    const startedInSession = currentSession();
    setPendingLineKey(line.key);
    try {
      const result = await cart.removeItems(lockKeys);
      switch (result.status) {
        case "confirmed": {
          const confirmed = removalConfirmed(result.publication, {
            lockKeys,
            startedInSession,
            currentSession: currentSession(),
          });
          if (confirmed) {
            toast.showToast({ variant: "success", title: i18n.t("cart.removed.title"), message: zoneName });
          } else {
            cart.requireCartReconciliation("unconfirmed-mutation");
            reportUnconfirmed();
          }
          return;
        }
        case "sessionEnded":
          // Expiry emptied the cart: never reported as a completed removal.
          toast.showToast({
            variant: "warning",
            title: i18n.t("cart.removal.sessionEnded.title"),
            message: i18n.t("cart.removal.sessionEnded.message"),
          });
          return;
        case "ambiguous":
          // The owner raised the shared gate (partial or unpublished delete).
          reportUnconfirmed();
          return;
        default:
          if (result.reason === "reconciliation-required") reportUnconfirmed();
          else toast.showToast({ variant: "warning", title: i18n.t("cart.actionFailed.title"), message: i18n.t("cart.removal.notPerformed") });
      }
    } catch (error) {
      reportFailure(error);
    } finally {
      setPendingLineKey(null);
    }
  };

  /** Re-reads the cart through its owner; the owner releases the gate only on a confirmed read. */
  const checkCart = async () => {
    if (checkingCart) return;
    setCheckingCart(true);
    try {
      const publication = await cart.refreshCart();
      if (publication.confirmed) return;
      toast.showToast({ variant: "error", title: i18n.t("cart.unconfirmed.title"), message: i18n.t("cart.check.failed") });
    } catch (error) {
      toast.showToast({ variant: "error", title: i18n.t("cart.unconfirmed.title"), message: userFacingError(error, i18n.t("cart.check.failed")) });
    } finally {
      setCheckingCart(false);
    }
  };

  return { pendingLineKey, busy, needsCartCheck, checkingCart, setQuantity, removeLine, checkCart };
}
