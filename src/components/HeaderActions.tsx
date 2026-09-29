import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useCartSheet } from "@/context/CartSheetContext";
import { useI18n } from "@/i18n/I18nProvider";
import { groupCartItems } from "@/lib/cartDisplay";
import { size } from "@/lib/designTokens";

type HeaderActionsProps = {
  hideCart?: boolean;
  onCartPress?: () => void;
};

/**
 * Header cart action (opens the cart sheet). The reservation countdown is no
 * longer repeated here: the global reservation indicator shows the owner's
 * countdown above these screens (`ReservationHoldBar`).
 */
export function HeaderActions({ hideCart = false, onCartPress }: HeaderActionsProps) {
  const theme = useTheme();
  const cart = useCart();
  const { plural, t } = useI18n();
  const { openCartSheet } = useCartSheet();
  const cartCount = groupCartItems(cart.items).length;
  const actionButton = {
    ...local.iconButton,
    backgroundColor: theme.colors.surface,
    borderColor: cartCount > 0 ? theme.colors.actionPrimary : theme.colors.border,
  };

  return (
    <View style={local.headerActions}>
      {!hideCart ? (
        <Pressable
          onPress={onCartPress ?? openCartSheet}
          style={({ pressed }) => [actionButton, local.cartButton, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={cartCount > 0 ? plural("header.cart.a11yCount", cartCount) : t("header.cart.a11y")}
          hitSlop={4}
        >
          <HeaderIcon name={{ ios: "cart", android: "shopping_cart", web: "shopping_cart" }} color={cartCount > 0 ? theme.colors.tones.brand.fg : theme.colors.textStrong} />
          {cartCount > 0 ? (
            <View
              style={[
                local.cartBadge,
                {
                  backgroundColor: theme.colors.actionPrimary,
                  borderColor: theme.colors.bg,
                },
              ]}
            >
              <Text style={[local.cartBadgeText, { color: theme.colors.onActionPrimary }]}>{cartCount}</Text>
            </View>
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
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    borderRadius: size.touchTargetMin / 2,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    position: "relative" as const,
  },
  cartButton: {
    overflow: "visible" as const,
  },
  cartBadge: {
    position: "absolute" as const,
    top: -5,
    end: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  cartBadgeText: {
    fontSize: 10,
    fontWeight: "900" as const,
    lineHeight: 12,
  },
};
