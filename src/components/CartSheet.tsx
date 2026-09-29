import { BottomSheetModal } from "@/components/BottomSheetModal";
import { CartLineItem } from "@/components/cart/CartLineItem";
import { CartNotice } from "@/components/cart/CartNotice";
import { ReservationStatus } from "@/components/cart/ReservationStatus";
import { AppText, SkeletonBlock, SkeletonGroup, StatePanel } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useCartLineActions } from "@/hooks/useCartLineActions";
import { useI18n } from "@/i18n/I18nProvider";
import { groupCartItems } from "@/lib/cartDisplay";
import { cartViewState, ticketCount } from "@/lib/cartPresentation";
import { radius, spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import { router } from "expo-router";
import { View } from "react-native";

type CartSheetProps = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Quick cart opened from the header cart button. Same owner, same line
 * actions and the same presentation rules as the Cart screen.
 */
export function CartSheet({ visible, onClose }: CartSheetProps) {
  const cart = useCart();
  const theme = useTheme();
  const i18n = useI18n();
  const actions = useCartLineActions();
  const groupedItems = groupCartItems(cart.items);
  const tickets = ticketCount(groupedItems);
  const viewState = cartViewState({
    sessionId: cart.sessionId,
    itemCount: groupedItems.length,
    refreshError: cart.cartRefreshError,
    secondsLeft: cart.secondsLeft,
  });
  const hasItems = viewState === "active" || viewState === "expired";
  const blocked = viewState !== "active" || actions.busy || actions.needsCartCheck || cart.isLoading;

  const viewCart = () => {
    onClose();
    router.navigate("/cart");
  };

  const checkout = () => {
    if (blocked) return;
    onClose();
    router.navigate("/checkout/ticket-holders");
  };

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title={i18n.t("cart.title")}
      subtitle={hasItems ? i18n.plural("cart.subtitle", tickets) : i18n.t("cart.noReservation")}
      scrollable
      contentContainerStyle={local.content}
    >
      {viewState === "loading" ? (
        <SkeletonGroup label={i18n.t("cart.loading")}>
          <SkeletonBlock height={120} borderRadius={radius.lg} />
        </SkeletonGroup>
      ) : viewState === "refreshFailed" ? (
        <StatePanel
          variant="error"
          title={i18n.t("cart.refreshFailed.title")}
          message={i18n.t("cart.refreshFailed.message")}
          action={{ label: i18n.t("common.retry"), onPress: () => void actions.checkCart() }}
        />
      ) : viewState === "empty" ? (
        <StatePanel variant="empty" title={i18n.t("cart.empty.title")} message={i18n.t("cart.empty.message")} />
      ) : (
        <>
          <ReservationStatus secondsLeft={cart.secondsLeft} />
          {viewState === "expired" ? (
            <StatePanel variant="unavailable" title={i18n.t("cart.expired.title")} message={i18n.t("cart.expired.message")} />
          ) : null}
          {actions.needsCartCheck ? (
            <CartNotice
              message={i18n.t("cart.unconfirmed.message")}
              action={{ label: i18n.t("cart.check.action"), busy: actions.checkingCart, onPress: () => void actions.checkCart() }}
            />
          ) : cart.cartRefreshError ? (
            <CartNotice
              message={i18n.t("cart.refreshWarning")}
              action={{ label: i18n.t("common.retry"), busy: actions.checkingCart, onPress: () => void actions.checkCart() }}
            />
          ) : null}

          {groupedItems.map((line) => {
            const zone = line.zone_name ?? i18n.t("cart.zoneFallback");
            return (
              <CartLineItem
                key={line.key}
                line={line}
                showMatch
                busy={actions.pendingLineKey === line.key}
                disabled={blocked}
                onChangeQuantity={(quantity) => void actions.setQuantity(line, quantity)}
                onRemove={() => void actions.removeLine(line, zone)}
              />
            );
          })}

          <View
            style={[local.total, { borderTopColor: theme.colors.border }]}
            accessible
            accessibilityLabel={`${i18n.t("cart.total")}, ${formatMoney(cart.total, cart.currency)}`}
          >
            <AppText variant="sectionTitle">{i18n.t("cart.total")}</AppText>
            <AppText variant="numeric">{formatMoney(cart.total, cart.currency)}</AppText>
          </View>

          <View style={local.actionsRow}>
            <View style={local.action}>
              <Button title={i18n.t("cart.viewCart")} variant="secondary" onPress={viewCart} />
            </View>
            <View style={local.action}>
              <Button
                title={i18n.t("cart.checkout")}
                onPress={checkout}
                disabled={blocked}
                accessibilityHint={i18n.t("cart.checkoutHint")}
              />
            </View>
          </View>
        </>
      )}
    </BottomSheetModal>
  );
}

const local = {
  content: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  total: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  actionsRow: { flexDirection: "row" as const, gap: spacing.sm },
  action: { flex: 1 },
};
