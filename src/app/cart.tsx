import { router } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Button, Card, Empty, Screen, useResponsive, useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { groupCartItems } from "@/lib/cartDisplay";
import { formatMoney, minutesSeconds } from "@/lib/format";

export default function CartScreen() {
  const cart = useCart();
  const responsive = useResponsive();
  const theme = useTheme();
  const toast = useToast();
  const groupedItems = groupCartItems(cart.items);
  const isWide = responsive.width >= 860;

  const removeItems = async (lockKeys: string[]) => {
    try {
      await cart.removeItems(lockKeys);
      toast.showToast({ variant: "success", title: "Removed from cart", message: "The ticket reservation was removed." });
    } catch (err) {
      toast.showToast({
        variant: "error",
        title: "Could not remove item",
        message: err instanceof Error ? err.message : "Please try again.",
      });
    }
  };

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="Your cart" subtitle={groupedItems.length ? `${groupedItems.length} item${groupedItems.length > 1 ? "s" : ""} reserved` : "No active reservation"} showBack={false} hideCart />
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 28 }}>
          {groupedItems.length ? (
            <View style={[local.cartLayout, isWide && local.cartLayoutWide]}>
              <View style={[local.itemsColumn, isWide && local.itemsColumnWide]}>
                <Card>
                  <View style={theme.styles.row}>
                    <Text style={theme.styles.h2}>Reservation</Text>
                    <Text style={[local.timer, { color: theme.colors.primary }]}>{minutesSeconds(cart.secondsLeft)}</Text>
                  </View>
                  <Text style={theme.styles.muted}>Checkout before the timer ends to keep these tickets.</Text>
                </Card>

                {groupedItems.map((item) => (
                  <Card key={item.key}>
                    <View style={theme.styles.row}>
                      <View style={local.itemMain}>
                        <Text style={theme.styles.h2}>{item.zone_name ?? "Ticket"}</Text>
                        <Text style={theme.styles.muted}>{item.match_title ?? `Match ${item.match_id}`}</Text>
                        <Text style={theme.styles.muted}>
                          {item.seats.length
                            ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}`
                            : `Qty: ${item.quantity}`}
                        </Text>
                      </View>
                      <Text style={[local.itemPrice, { color: theme.colors.primary }]}>{formatMoney(item.subtotal, item.currency)}</Text>
                    </View>
                    <View style={theme.styles.row}>
                      <Text style={theme.styles.muted}>{formatMoney(item.unit_price, item.currency)} / ticket</Text>
                      <Button title="Remove" variant="danger" onPress={() => void removeItems(item.lockKeys)} />
                    </View>
                  </Card>
                ))}
              </View>

              <View style={[local.summaryColumn, isWide && local.summaryColumnWide]}>
                <Card>
                  <Text style={theme.styles.h2}>Order summary</Text>
                  <Text style={theme.styles.muted}>{groupedItems.length} item{groupedItems.length === 1 ? "" : "s"} reserved</Text>
                  {groupedItems.map((item) => (
                    <View key={item.key} style={[local.summaryItem, { borderTopColor: theme.colors.line }]}>
                      <View style={local.summaryMain}>
                        <Text numberOfLines={1} style={[local.summaryTitle, { color: theme.colors.ink }]}>{item.zone_name ?? "Ticket"}</Text>
                        <Text numberOfLines={1} style={theme.styles.muted}>{item.match_title ?? `Match ${item.match_id}`}</Text>
                        <Text style={theme.styles.muted}>
                          {item.seats.length
                            ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}`
                            : `Qty: ${item.quantity}`}
                        </Text>
                      </View>
                      <Text style={[local.summaryPrice, { color: theme.colors.ink }]}>{formatMoney(item.subtotal, item.currency)}</Text>
                    </View>
                  ))}
                  <View style={[local.summaryTotal, { borderTopColor: theme.colors.line }]}>
                    <Text style={theme.styles.h2}>Total</Text>
                    <Text style={theme.styles.h2}>{formatMoney(cart.total, cart.currency)}</Text>
                  </View>
                </Card>

                <Button title="Checkout" onPress={() => router.push("/checkout")} />
              </View>
            </View>
          ) : cart.cartRefreshError ? (
            <Card>
              <Empty title="Unable to load your cart" detail={cart.cartRefreshError} />
              <Button title="Retry" onPress={() => void cart.refreshCart()} />
            </Card>
          ) : (
            <Empty title="Your cart is empty" detail="Pick a match and reserve tickets to start checkout." />
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
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
  timer: { fontWeight: "900" as const },
  itemMain: { flex: 1, gap: 4 },
  itemPrice: { fontSize: 16, fontWeight: "900" as const },
};
