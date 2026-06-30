import { router } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { Button, Card, Empty, Screen, colors, styles, useResponsive } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { groupCartItems } from "@/lib/cartDisplay";
import { formatMoney, minutesSeconds } from "@/lib/format";

export default function CartScreen() {
  const cart = useCart();
  const responsive = useResponsive();
  const toast = useToast();
  const groupedItems = groupCartItems(cart.items);

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
        <AppHeader title="Your cart" subtitle={groupedItems.length ? `${groupedItems.length} item${groupedItems.length > 1 ? "s" : ""} reserved` : "No active reservation"} />
        <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 28 }}>
          {groupedItems.length ? (
            <>
              <Card>
                <View style={styles.row}>
                  <Text style={styles.h2}>Reservation</Text>
                  <Text style={local.timer}>{minutesSeconds(cart.secondsLeft)}</Text>
                </View>
                <Text style={styles.muted}>Checkout before the timer ends to keep these tickets.</Text>
              </Card>

              {groupedItems.map((item) => (
                <Card key={item.key}>
                  <View style={styles.row}>
                    <View style={local.itemMain}>
                      <Text style={styles.h2}>{item.zone_name ?? "Ticket"}</Text>
                      <Text style={styles.muted}>{item.match_title ?? `Match ${item.match_id}`}</Text>
                      <Text style={styles.muted}>
                        {item.seats.length
                          ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}`
                          : `Qty: ${item.quantity}`}
                      </Text>
                    </View>
                    <Text style={local.itemPrice}>{formatMoney(item.subtotal, item.currency)}</Text>
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.muted}>{formatMoney(item.unit_price, item.currency)} / ticket</Text>
                    <Button title="Remove" variant="danger" onPress={() => void removeItems(item.lockKeys)} />
                  </View>
                </Card>
              ))}

              <Card>
                <View style={styles.row}>
                  <Text style={styles.h2}>Total</Text>
                  <Text style={styles.h2}>{formatMoney(cart.total, cart.currency)}</Text>
                </View>
              </Card>

              <Button title="Checkout" onPress={() => router.push("/checkout")} />
            </>
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
  timer: { color: colors.primary, fontWeight: "900" as const },
  itemMain: { flex: 1, gap: 4 },
  itemPrice: { color: colors.primary, fontSize: 16, fontWeight: "900" as const },
};
