import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { colors, styles } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { groupCartItems } from "@/lib/cartDisplay";

export function AppHeader({
  title,
  subtitle,
  showBack = true,
  onBack,
}: {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const cart = useCart();
  const cartCount = groupCartItems(cart.items).length;
  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  return (
    <View style={local.header}>
      <View style={local.left}>
        {showBack ? (
          <Pressable onPress={handleBack} style={local.iconButton}>
            <View style={local.backChevron} />
          </Pressable>
        ) : null}
        <View style={local.copy}>
          <Text numberOfLines={1} style={local.title}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={styles.muted}>{subtitle}</Text> : null}
        </View>
      </View>
      <Pressable onPress={() => router.push("/cart")} style={[local.cartButton, cartCount > 0 && local.cartButtonActive]}>
        <CartGlyph active={cartCount > 0} />
        {cartCount > 0 ? (
          <View style={local.cartCount}><Text style={local.cartCountText}>{cartCount}</Text></View>
        ) : null}
      </Pressable>
    </View>
  );
}

function CartGlyph({ active }: { active: boolean }) {
  return (
    <View style={local.cartGlyph}>
      <View style={[local.cartBasket, active && local.cartBasketActive]} />
      <View style={local.cartWheels}>
        <View style={[local.cartWheel, active && local.cartWheelActive]} />
        <View style={[local.cartWheel, active && local.cartWheelActive]} />
      </View>
    </View>
  );
}

const local = {
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  left: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
  copy: { flex: 1 },
  title: { color: colors.ink, fontSize: 18, fontWeight: "900" as const },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  backChevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.ink,
    transform: [{ rotate: "45deg" }],
    marginLeft: 4,
  },
  cartButton: {
    width: 44,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    position: "relative" as const,
  },
  cartButtonActive: { borderColor: colors.primary, backgroundColor: "rgba(200,16,46,0.08)" },
  cartGlyph: { width: 22, height: 21, justifyContent: "flex-end" as const },
  cartBasket: {
    width: 21,
    height: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 3,
    transform: [{ skewX: "-8deg" }],
  },
  cartBasketActive: { borderColor: colors.primary },
  cartWheels: {
    flexDirection: "row" as const,
    gap: 9,
    paddingLeft: 3,
    paddingTop: 2,
  },
  cartWheel: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.ink },
  cartWheelActive: { backgroundColor: colors.primary },
  cartCount: {
    position: "absolute" as const,
    top: -7,
    right: -7,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  cartCountText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" as const },
};
