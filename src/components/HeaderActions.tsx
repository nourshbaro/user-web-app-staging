import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useCartSheet } from "@/context/CartSheetContext";
import { groupCartItems } from "@/lib/cartDisplay";
import { minutesSeconds } from "@/lib/format";

type HeaderActionsProps = {
  hideCart?: boolean;
};

export function HeaderActions({ hideCart = false }: HeaderActionsProps) {
  const theme = useTheme();
  const cart = useCart();
  const { openCartSheet } = useCartSheet();
  const cartCount = groupCartItems(cart.items).length;
  const actionButton = {
    ...local.iconButton,
    backgroundColor: theme.isDark ? theme.colors.panelSoft : "#F1F5F9",
    borderColor: theme.colors.line,
    shadowColor: theme.colors.ink,
    shadowOpacity: theme.isDark ? 0.26 : 0.08,
  };

  return (
    <View style={local.headerActions}>
      <Pressable accessibilityLabel={theme.isDark ? "Switch to light mode" : "Switch to dark mode"} onPress={theme.toggleTheme} style={actionButton}>
        <HeaderIcon name={theme.isDark ? { ios: "sun.max", android: "light_mode", web: "light_mode" } : { ios: "moon", android: "dark_mode", web: "dark_mode" }} color={theme.colors.secondary} />
      </Pressable>

      {!hideCart ? (
        <Pressable
          onPress={openCartSheet}
          style={[actionButton, local.cartButton, cartCount > 0 && { borderColor: theme.colors.primary }]}
          accessibilityLabel="Cart"
        >
          <HeaderIcon name={{ ios: "cart", android: "shopping_cart", web: "shopping_cart" }} color={cartCount > 0 ? theme.colors.primary : theme.colors.secondary} />
          {cartCount > 0 ? (
            <>
              <View
                style={[
                  local.cartBadge,
                  {
                    backgroundColor: theme.colors.primary,
                    borderColor: theme.colors.bg,
                  },
                ]}
              >
                <Text style={local.cartBadgeText}>{cartCount}</Text>
              </View>
              <View style={[local.cartTimerBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.bg }]}>
                <Text style={local.cartTimerText}>{minutesSeconds(cart.secondsLeft)}</Text>
              </View>
            </>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

function HeaderIcon({ name, color }: { name: any; color: string }) {
  return <SymbolView name={name} size={18} tintColor={color} fallback={<Text style={{ color, fontSize: 18, fontWeight: "700" }}>C</Text>} />;
}

const local = {
  headerActions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    position: "relative" as const,
  },
  cartButton: {
    overflow: "visible" as const,
  },
  cartBadge: {
    position: "absolute" as const,
    top: -7,
    right: -7,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  cartBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900" as const,
    lineHeight: 12,
  },
  cartTimerBadge: {
    position: "absolute" as const,
    right: -7,
    bottom: -9,
    minWidth: 34,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  cartTimerText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900" as const,
    lineHeight: 11,
  },
};
