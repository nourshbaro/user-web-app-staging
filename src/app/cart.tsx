import { AppHeader } from "@/components/AppHeader";
import {
  Button,
  Card,
  Empty,
  Screen,
  useResponsive,
  useTheme,
} from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { groupCartItems } from "@/lib/cartDisplay";
import { formatMoney } from "@/lib/format";
import { userFacingError } from "@/lib/userFacingError";
import { router, Stack } from "expo-router";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { useCallback, useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Bottom action bar height reserved in scroll content so the last card is
// never hidden underneath the fixed Continue Shopping / Checkout bar.
const ACTION_BAR_HEIGHT = 64;

function CartScreen() {
  const cart = useCart();
  const responsive = useResponsive();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const groupedItems = groupCartItems(cart.items);
  const isWide = responsive.width >= 860;
  const hasItems = groupedItems.length > 0;
  const bottomBarPadding = Math.max(insets.bottom, 12);

  const removeItems = async (lockKeys: string[]) => {
    try {
      await cart.removeItems(lockKeys);
      toast.showToast({
        variant: "success",
        title: "Removed from cart",
        message: "The ticket reservation was removed.",
      });
    } catch (err) {
      toast.showToast({
        variant: "error",
        title: "Could not remove item",
        message: userFacingError(
          err,
          "Could not update your cart. Please try again.",
        ),
      });
    }
  };

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

  const goToCheckout = () => {
    if (!hasItems) return;
    router.replace("/checkout/ticket-holders");
  };

  return (
    <Screen>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader
          title="Your cart"
          subtitle={
            hasItems
              ? `${groupedItems.length} item${groupedItems.length > 1 ? "s" : ""} reserved`
              : "No active reservation"
          }
          hideCart
          showTimer={hasItems}
          onBack={goBack}
        />
        {/* Elevated, dedicated countdown — not buried as plain text inside
            the Reservation card. Same authoritative source as everywhere
            else (cart.secondsLeft from CartContext / CartTimer's shared,
            tabular-nums, non-clipping rendering) — just a more deliberate
            presentation, always visible above the fold. */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            gap: 12,
            paddingBottom: hasItems
              ? ACTION_BAR_HEIGHT + bottomBarPadding + 16
              : 28,
          }}
        >
          {hasItems ? (
            <View style={[local.cartLayout, isWide && local.cartLayoutWide]}>
              <View
                style={[local.itemsColumn, isWide && local.itemsColumnWide]}
              >
                {/* <Card>
                  <Text style={theme.styles.h2}>Reservation</Text>
                  <Text style={theme.styles.muted}>Checkout before the timer above ends to keep these tickets.</Text>
                </Card> */}

                {groupedItems.map((item) => (
                  <Card key={item.key}>
                    <View style={theme.styles.row}>
                      <View style={local.itemMain}>
                        <Text style={theme.styles.h2}>
                          {item.zone_name ?? "Ticket"}
                        </Text>
                        <Text style={theme.styles.muted}>
                          {item.match_title ?? `Match ${item.match_id}`}
                        </Text>
                        <Text style={theme.styles.muted}>
                          {item.seats.length
                            ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}`
                            : `Qty: ${item.quantity}`}
                        </Text>
                      </View>
                      <Text
                        style={[
                          local.itemPrice,
                          { color: theme.colors.primary },
                        ]}
                      >
                        {formatMoney(item.subtotal, item.currency)}
                      </Text>
                    </View>
                    <View style={theme.styles.row}>
                      <Text style={theme.styles.muted}>
                        {formatMoney(item.unit_price, item.currency)} / ticket
                      </Text>
                      <Button
                        title="Remove"
                        variant="danger"
                        onPress={() => void removeItems(item.lockKeys)}
                      />
                    </View>
                  </Card>
                ))}
              </View>

              <View
                style={[local.summaryColumn, isWide && local.summaryColumnWide]}
              >
                {/* <Card>
                  <Text style={theme.styles.h2}>Order summary</Text>
                  <Text style={theme.styles.muted}>
                    {groupedItems.length} item
                    {groupedItems.length === 1 ? "" : "s"} reserved
                  </Text>
                  {groupedItems.map((item) => (
                    <View
                      key={item.key}
                      style={[
                        local.summaryItem,
                        { borderTopColor: theme.colors.line },
                      ]}
                    >
                      <View style={local.summaryMain}>
                        <Text
                          numberOfLines={1}
                          style={[
                            local.summaryTitle,
                            { color: theme.colors.ink },
                          ]}
                        >
                          {item.zone_name ?? "Ticket"}
                        </Text>
                        <Text numberOfLines={1} style={theme.styles.muted}>
                          {item.match_title ?? `Match ${item.match_id}`}
                        </Text>
                        <Text style={theme.styles.muted}>
                          {item.seats.length
                            ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}`
                            : `Qty: ${item.quantity}`}
                        </Text>
                      </View>
                      <Text
                        style={[
                          local.summaryPrice,
                          { color: theme.colors.ink },
                        ]}
                      >
                        {formatMoney(item.subtotal, item.currency)}
                      </Text>
                    </View>
                  ))}
                  <View
                    style={[
                      local.summaryTotal,
                      { borderTopColor: theme.colors.line },
                    ]}
                  >
                    <Text style={theme.styles.h2}>Total</Text>
                    <Text style={theme.styles.h2}>
                      {formatMoney(cart.total, cart.currency)}
                    </Text>
                  </View>
                </Card> */}
              </View>
            </View>
          ) : cart.cartRefreshError ? (
            <Card>
              <Empty
                title="Unable to load your cart"
                detail={cart.cartRefreshError}
              />
              <Button title="Retry" onPress={() => void cart.refreshCart()} />
            </Card>
          ) : (
            <Empty
              title="Your cart is empty"
              detail="Pick a match and reserve tickets to start checkout."
            />
          )}
        </ScrollView>
      </View>

      {hasItems ? (
        <View
          style={[
            local.actionBar,
            {
              paddingBottom: bottomBarPadding,
              backgroundColor: theme.colors.bg,
              borderTopColor: theme.colors.line,
            },
          ]}
        >
          <View
            style={[local.actionBarRow, { width: responsive.contentWidth }]}
          >
            <View style={local.actionButton}>
              <Button
                title="Continue Shopping"
                variant="secondary"
                onPress={continueShopping}
              />
            </View>
            <View style={local.actionButton}>
              <Button
                title="Checkout"
                onPress={goToCheckout}
                disabled={cart.isLoading}
              />
            </View>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  // Dedicated countdown row, elevated above the scrollable content instead
  // of buried as plain text inside the Reservation card.
  timerBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 10,
    paddingBottom: 12,
  },
  timerBarLabel: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  timerDot: { width: 8, height: 8, borderRadius: 4 },
  timerPill: {
    flexShrink: 0,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  timerPillText: { fontSize: 18, fontWeight: "900" as const },
  cartLayout: { gap: 12 },
  cartLayoutWide: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
  },
  itemsColumn: { gap: 12 },
  itemsColumnWide: {
    flex: 1,
    minWidth: 0,
  },
  summaryColumn: { gap: 12 },
  summaryColumnWide: {
    width: 320,
    position: "sticky" as any,
    top: 0,
  },
  summaryItem: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10,
    borderTopWidth: 1,
    paddingTop: 10,
  },
  summaryMain: { flex: 1, minWidth: 0 },
  summaryTitle: { fontSize: 14, fontWeight: "900" as const },
  summaryPrice: { fontSize: 13, fontWeight: "900" as const },
  summaryTotal: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  itemMain: { flex: 1, gap: 4 },
  itemPrice: { fontSize: 16, fontWeight: "900" as const },
  // Fixed/sticky bottom action bar — respects the safe-area inset via
  // `paddingBottom` computed from useSafeAreaInsets() above.
  actionBar: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 14,
    alignItems: "center" as const,
  },
  actionBarRow: {
    flexDirection: "row" as const,
    gap: 12,
  },
  actionButton: { flex: 1 },
};

export default withAuthRequired(CartScreen);
