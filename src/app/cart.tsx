import { FlowHeader } from "@/components/FlowHeader";
import { CartGroupCard, CartLineItem } from "@/components/cart/CartLineItem";
import { CartNotice } from "@/components/cart/CartNotice";
import { ReservationStatus } from "@/components/cart/ReservationStatus";
import {
  AppText,
  SkeletonBlock,
  SkeletonGroup,
  StatePanel,
  TransactionBar,
} from "@/components/foundation";
import { Button, useResponsive, useTheme } from "@/components/ui";
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
import { layout, radius, spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, BackHandler, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Readable single column on tablets and web.
const COLUMN_MAX_WIDTH = 720;

function CartScreen() {
  const cart = useCart();
  const theme = useTheme();
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();
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
  const columnWidth = Math.min(responsive.contentWidth, COLUMN_MAX_WIDTH);

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

  const totalLabel = formatMoney(cart.total, cart.currency);

  return (
    <View style={[local.root, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={[local.header, { paddingTop: insets.top }]}>
        <FlowHeader
          title={i18n.t("cart.header")}
          subtitle={hasItems ? i18n.plural("cart.subtitle", tickets) : undefined}
          onBack={goBack}
        />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          local.content,
          { width: columnWidth, paddingBottom: hasItems ? barHeight + spacing.lg : spacing.xxxl },
        ]}
      >
        {viewState === "loading" ? (
          <>
            {/* v3 pending cart: nothing is shown as confirmed until LFA answers. */}
            <View
              style={[local.pending, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={`${i18n.t("cart.pending.title")}. ${i18n.t("cart.pending.message")}`}
              aria-busy
            >
              <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
              <AppText variant="bodyStrong" align="center" style={local.pendingTitle}>{i18n.t("cart.pending.title")}</AppText>
              <AppText variant="meta" tone="muted" align="center" style={local.regular}>{i18n.t("cart.pending.message")}</AppText>
            </View>
            <SkeletonGroup label={i18n.t("cart.loading")}>
              {/* The cart group card's outline: match header, then ticket lines. */}
              <View style={[local.skeletonCard, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
                <SkeletonBlock width="55%" height={16} />
                {[0, 1].map((line) => (
                  <View key={line} style={local.skeletonLine}>
                    <View style={local.skeletonCopy}>
                      <SkeletonBlock width="50%" height={14} />
                      <SkeletonBlock width="30%" height={12} />
                    </View>
                    <SkeletonBlock width={96} height={36} borderRadius={18} />
                  </View>
                ))}
              </View>
            </SkeletonGroup>
          </>
        ) : viewState === "refreshFailed" ? (
          <StatePanel
            variant="error"
            title={i18n.t("cart.refreshFailed.title")}
            message={cart.cartRefreshError ?? i18n.t("cart.refreshFailed.message")}
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
                message={cart.cartRefreshError}
                action={{
                  label: i18n.t("common.retry"),
                  busy: actions.checkingCart,
                  onPress: () => void actions.checkCart(),
                }}
              />
            ) : null}

            {matchGroups.map((group) => (
              <CartGroupCard
                key={group.matchId}
                title={group.matchTitle ?? i18n.t("cart.matchFallback", { id: group.matchId })}
              >
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
              </CartGroupCard>
            ))}

            {/* The total is the owner's authoritative cart.total, never a client sum. */}
            <View
              style={[local.total, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}
              accessible
              accessibilityLabel={`${i18n.t("cart.total")}, ${totalLabel}. ${i18n.t("cart.totalConfirmed")}`}
            >
              <View style={local.totalCopy}>
                <AppText variant="bodyStrong" style={local.totalTitle}>{i18n.t("cart.total")}</AppText>
                <AppText variant="caption" tone="muted" style={local.regular}>{i18n.t("cart.totalConfirmed")}</AppText>
              </View>
              <AppText variant="displayNumeral" style={local.totalValue}>{totalLabel}</AppText>
            </View>

            <Button title={i18n.t("cart.continueShopping")} variant="ghost" onPress={continueShopping} />
          </>
        )}
      </ScrollView>

      {/* Presentation-only TransactionBar: readiness and navigation stay with
          this screen; the bar never owns cart state. */}
      {hasItems ? (
        <View
          style={local.actionBar}
          onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
        >
          <TransactionBar
            stacked
            note={i18n.t("cart.continueNote", {
              tickets: i18n.plural("transaction.ticketCount", tickets),
            })}
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
    </View>
  );
}

const local = {
  skeletonCard: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  skeletonLine: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  skeletonCopy: { flex: 1, gap: spacing.sm },
  root: { flex: 1 },
  header: { width: "100%" as const, paddingHorizontal: layout.gutter },
  content: {
    alignSelf: "center" as const,
    gap: 14,
    paddingTop: spacing.sm,
  },
  pending: { borderRadius: 20, padding: spacing.xl, alignItems: "center" as const, gap: spacing.sm },
  pendingTitle: { fontSize: 16, marginTop: spacing.xs },
  regular: { fontWeight: "400" as const },
  // v3 total card: "Total" 16/600, note 12, amount 28 display.
  total: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  totalCopy: { flex: 1, minWidth: 0, gap: 2 },
  totalTitle: { fontSize: 16, lineHeight: 21 },
  totalValue: { fontSize: 28, lineHeight: 34, flexShrink: 1 },
  actionBar: { position: "absolute" as const, left: 0, right: 0, bottom: 0 },
};

export default withAuthRequired(CartScreen);
