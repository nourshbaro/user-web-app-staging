import { AppHeader } from "@/components/AppHeader";
import { CartLineItem } from "@/components/cart/CartLineItem";
import { CartNotice } from "@/components/cart/CartNotice";
import { ReservationStatus } from "@/components/cart/ReservationStatus";
import {
  AppText,
  SkeletonBlock,
  SkeletonGroup,
  StatePanel,
  TransactionBar,
} from "@/components/foundation";
import { Button, Screen, useResponsive } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useCart } from "@/context/CartContext";
import { useCartLineActions } from "@/hooks/useCartLineActions";
import { useI18n } from "@/i18n/I18nProvider";
import { groupCartItems } from "@/lib/cartDisplay";
import {
  cartViewState,
  groupLinesByMatch,
  ticketCount,
} from "@/lib/cartPresentation";
import { radius, spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, View } from "react-native";

// Readable single column on tablets and web.
const COLUMN_MAX_WIDTH = 720;

function CartScreen() {
  const cart = useCart();
  const responsive = useResponsive();
  const i18n = useI18n();
  const actions = useCartLineActions();
  const [barHeight, setBarHeight] = useState(0);
  const groupedItems = useMemo(() => groupCartItems(cart.items), [cart.items]);
  const matchGroups = groupLinesByMatch(groupedItems);
  const tickets = ticketCount(groupedItems);
  const viewState = cartViewState({
    sessionId: cart.sessionId,
    itemCount: groupedItems.length,
    refreshError: cart.cartRefreshError,
    secondsLeft: cart.secondsLeft,
  });
  const hasItems = viewState === "active" || viewState === "expired";
  const lineActionsBlocked =
    viewState !== "active" || actions.busy || actions.needsCartCheck || cart.isLoading;

  const continueShopping = useCallback(() => {
    // Preserve the cart — this only navigates, it never clears it. Prefer
    // returning to wherever the user came from (e.g. the match they were
    // browsing) over always landing on Home.
    const matchIds = [...new Set(groupedItems.map((item) => String(item.match_id)))];
    if (matchIds.length === 1) {
      router.dismissTo({ pathname: "/match/[id]", params: { id: matchIds[0] } });
      return;
    }
    router.dismissTo("/matches");
  }, [groupedItems]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [goBack]);

  const checkoutBlocked =
    viewState !== "active" || cart.isLoading || actions.busy || actions.needsCartCheck;

  const goToCheckout = () => {
    if (checkoutBlocked) return;
    router.replace("/checkout/ticket-holders");
  };

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader
          title={i18n.t("cart.title")}
          subtitle={hasItems ? i18n.plural("cart.subtitle", tickets) : i18n.t("cart.noReservation")}
          hideCart
          onBack={goBack}
        />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            local.content,
            { paddingBottom: hasItems ? barHeight + spacing.lg : spacing.xxxl },
          ]}
        >
          {viewState === "loading" ? (
            <SkeletonGroup label={i18n.t("cart.loading")}>
              <SkeletonBlock height={64} borderRadius={radius.md} />
              <SkeletonBlock height={148} borderRadius={radius.lg} />
              <SkeletonBlock height={148} borderRadius={radius.lg} />
            </SkeletonGroup>
          ) : viewState === "refreshFailed" ? (
            <StatePanel
              variant="error"
              title={i18n.t("cart.refreshFailed.title")}
              message={i18n.t("cart.refreshFailed.message")}
              action={{ label: i18n.t("common.retry"), onPress: () => void actions.checkCart() }}
            />
          ) : viewState === "empty" ? (
            <StatePanel
              variant="empty"
              title={i18n.t("cart.empty.title")}
              message={i18n.t("cart.empty.message")}
              action={{ label: i18n.t("cart.empty.action"), onPress: () => router.dismissTo("/matches") }}
            />
          ) : (
            <>
              <ReservationStatus secondsLeft={cart.secondsLeft} />

              {viewState === "expired" ? (
                <StatePanel
                  variant="unavailable"
                  title={i18n.t("cart.expired.title")}
                  message={i18n.t("cart.expired.message")}
                />
              ) : null}

              {actions.needsCartCheck ? (
                <CartNotice
                  tone="warning"
                  message={i18n.t("cart.unconfirmed.message")}
                  action={{
                    label: i18n.t("cart.check.action"),
                    busy: actions.checkingCart,
                    onPress: () => void actions.checkCart(),
                  }}
                />
              ) : cart.cartRefreshError ? (
                <CartNotice
                  tone="warning"
                  message={i18n.t("cart.refreshWarning")}
                  action={{
                    label: i18n.t("common.retry"),
                    busy: actions.checkingCart,
                    onPress: () => void actions.checkCart(),
                  }}
                />
              ) : null}

              {matchGroups.map((group) => (
                <View key={group.matchId} style={local.group}>
                  <AppText variant="sectionTitle" accessibilityRole="header" numberOfLines={2}>
                    {group.matchTitle ?? i18n.t("cart.matchFallback", { id: group.matchId })}
                  </AppText>
                  {group.lines.map((line) => {
                    const zone = line.zone_name ?? i18n.t("cart.zoneFallback");
                    return (
                      <CartLineItem
                        key={line.key}
                        line={line}
                        showMatch={false}
                        busy={actions.pendingLineKey === line.key}
                        disabled={lineActionsBlocked}
                        onChangeQuantity={(quantity) => void actions.setQuantity(line, quantity)}
                        onRemove={() => void actions.removeLine(line, zone)}
                      />
                    );
                  })}
                </View>
              ))}

              <Button title={i18n.t("cart.continueShopping")} variant="secondary" onPress={continueShopping} />
            </>
          )}
        </ScrollView>
      </View>

      {/* Presentation-only TransactionBar: the total is the owner's
          authoritative cart.total; the bar never owns cart state. */}
      {hasItems ? (
        <View
          style={local.actionBar}
          onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
        >
          <TransactionBar
            totalLabel={i18n.t("cart.total")}
            totalValue={formatMoney(cart.total, cart.currency)}
            countLabel={i18n.plural("transaction.ticketCount", tickets)}
            primaryAction={{
              label: i18n.t("cart.checkout"),
              onPress: goToCheckout,
              disabled: checkoutBlocked,
              busy: cart.isLoading || actions.busy,
              accessibilityHint: i18n.t("cart.checkoutHint"),
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  content: {
    width: "100%" as const,
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: "center" as const,
    gap: spacing.lg,
  },
  group: { gap: spacing.md },
  actionBar: { position: "absolute" as const, left: 0, right: 0, bottom: 0 },
};

export default withAuthRequired(CartScreen);
