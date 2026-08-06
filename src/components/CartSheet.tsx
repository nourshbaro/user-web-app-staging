import { router } from "expo-router";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Button, Card, Empty, colors, styles, useResponsive, useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { groupCartItems } from "@/lib/cartDisplay";
import { formatMoney, minutesSeconds } from "@/lib/format";

type CartSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function CartSheet({ visible, onClose }: CartSheetProps) {
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

  const checkout = () => {
    onClose();
    router.push("/checkout");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[local.modalOverlay, theme.isDark && local.modalOverlayDark]}>
        <View style={[local.modalSheet, { backgroundColor: theme.colors.bg, borderColor: theme.colors.line }]}> 
          <View style={[local.sheetHandle, { backgroundColor: theme.colors.muted }]} />
          <View style={[local.modalHeader, { borderBottomColor: theme.colors.line }]}>
            <View style={local.modalTitleWrap}>
              <Text style={[local.modalTitle, { color: theme.colors.ink }]}>Your cart</Text>
              <Text style={[styles.muted, local.modalSubtitle]}>
                {groupedItems.length ? `${groupedItems.length} item${groupedItems.length > 1 ? "s" : ""} reserved` : "No active reservation"}
              </Text>
            </View>
            <Pressable onPress={onClose} style={[local.closeButton, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
              <Text style={[local.closeText, { color: theme.colors.ink }]}>Close</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={local.content}>
            {groupedItems.length ? (
              <View style={[local.cartLayout, isWide && local.cartLayoutWide]}>
                <View style={[local.itemsColumn, isWide && local.itemsColumnWide]}>
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
                </View>

                <View style={[local.summaryColumn, isWide && local.summaryColumnWide]}>
                  <Card>
                    <Text style={styles.h2}>Order summary</Text>
                    <Text style={styles.muted}>{groupedItems.length} item{groupedItems.length === 1 ? "" : "s"} reserved</Text>
                    {groupedItems.map((item) => (
                      <View key={item.key} style={[local.summaryItem, { borderTopColor: theme.colors.line }]}>
                        <View style={local.summaryMain}>
                          <Text numberOfLines={1} style={[local.summaryTitle, { color: theme.colors.ink }]}>{item.zone_name ?? "Ticket"}</Text>
                          <Text numberOfLines={1} style={styles.muted}>{item.match_title ?? `Match ${item.match_id}`}</Text>
                          <Text style={styles.muted}>
                            {item.seats.length
                              ? `Seats: ${item.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`).join(", ")}`
                              : `Qty: ${item.quantity}`}
                          </Text>
                        </View>
                        <Text style={[local.summaryPrice, { color: theme.colors.ink }]}>{formatMoney(item.subtotal, item.currency)}</Text>
                      </View>
                    ))}
                    <View style={[local.summaryTotal, { borderTopColor: theme.colors.line }]}>
                      <Text style={styles.h2}>Total</Text>
                      <Text style={styles.h2}>{formatMoney(cart.total, cart.currency)}</Text>
                    </View>
                  </Card>

                  <Button title="Checkout" onPress={checkout} />
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
      </View>
    </Modal>
  );
}

const local = {
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(21,26,44,0.48)",
  },
  modalOverlayDark: { backgroundColor: "rgba(0,0,0,0.78)" },
  modalSheet: {
    maxHeight: "92%" as const,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderWidth: 1,
    borderBottomWidth: 0,
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, opacity: 0.45, alignSelf: "center" as const, marginBottom: 10 },
  modalHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 12,
  },
  modalTitleWrap: { flex: 1, minWidth: 0 },
  modalTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" as const, lineHeight: 28 },
  modalSubtitle: { lineHeight: 18 },
  closeButton: {
    minHeight: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 12,
  },
  closeText: { color: colors.ink, fontSize: 13, fontWeight: "900" as const },
  content: { gap: 12, paddingTop: 12, paddingBottom: 26 },
  cartLayout: { gap: 12 },
  cartLayoutWide: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
  },
  itemsColumn: { gap: 12 },
  itemsColumnWide: { flex: 1, minWidth: 0 },
  summaryColumn: { gap: 12 },
  summaryColumnWide: { width: 320 },
  summaryItem: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  summaryMain: { flex: 1, minWidth: 0 },
  summaryTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" as const },
  summaryPrice: { color: colors.ink, fontSize: 13, fontWeight: "900" as const },
  summaryTotal: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  timer: { color: colors.primary, fontWeight: "900" as const },
  itemMain: { flex: 1, gap: 4 },
  itemPrice: { color: colors.primary, fontSize: 16, fontWeight: "900" as const },
};
