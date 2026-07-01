import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, Text, View } from "react-native";
import { colors, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { groupCartItems } from "@/lib/cartDisplay";
import { minutesSeconds } from "@/lib/format";

type HeaderActionsProps = {
  hideCart?: boolean;
  onLogout?: () => void | Promise<void>;
};

export function HeaderActions({ hideCart = false, onLogout }: HeaderActionsProps) {
  const theme = useTheme();
  const auth = useAuth();
  const cart = useCart();
  const cartCount = groupCartItems(cart.items).length;
  const actionButton = {
    ...local.iconButton,
    backgroundColor: theme.isDark ? theme.colors.panelSoft : "#F1F5F9",
    borderColor: theme.colors.line,
    shadowOpacity: theme.isDark ? 0.26 : 0.08,
  };
  const loginButton = {
    ...local.loginButton,
    backgroundColor: theme.isDark ? theme.colors.panelSoft : "#F1F5F9",
    borderColor: theme.colors.line,
    shadowOpacity: theme.isDark ? 0.26 : 0.08,
  };

  const logout = async () => {
    if (onLogout) {
      await onLogout();
      return;
    }
    await auth.logout();
    router.replace("/");
  };

  return (
    <View style={local.headerActions}>
      <Pressable accessibilityLabel={theme.isDark ? "Switch to light mode" : "Switch to dark mode"} onPress={theme.toggleTheme} style={actionButton}>
        <HeaderIcon name={theme.isDark ? { ios: "sun.max", android: "light_mode", web: "light_mode" } : { ios: "moon", android: "dark_mode", web: "dark_mode" }} color={theme.colors.secondary} />
      </Pressable>

      {!hideCart && cartCount > 0 ? (
        <Pressable onPress={() => router.push("/cart")} style={[actionButton, local.cartButton, { borderColor: theme.colors.primary }]} accessibilityLabel="Cart">
          <HeaderIcon name={{ ios: "cart", android: "shopping_cart", web: "shopping_cart" }} color={theme.colors.primary} />
          <View style={[local.cartBadge, { borderColor: theme.colors.bg }]}>
            <Text style={local.cartBadgeText}>{cartCount}</Text>
          </View>
          <View style={[local.cartTimerBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.bg }]}>
            <Text style={local.cartTimerText}>{minutesSeconds(cart.secondsLeft)}</Text>
          </View>
        </Pressable>
      ) : null}

      {auth.isAuthenticated ? (
        <>
          <Pressable onPress={() => router.push("/profile")} style={actionButton} accessibilityLabel="Profile">
            <HeaderIcon name={{ ios: "person", android: "person_outline", web: "person_outline" }} color={theme.colors.secondary} />
          </Pressable>
          <Pressable onPress={() => void logout()} style={actionButton} accessibilityLabel="Logout">
            <HeaderIcon name={{ ios: "rectangle.portrait.and.arrow.right", android: "logout", web: "logout" }} color={theme.colors.secondary} />
          </Pressable>
        </>
      ) : (
        <Pressable onPress={() => router.push("/auth")} style={loginButton} accessibilityLabel="Login">
          <HeaderIcon name={{ ios: "rectangle.portrait.and.arrow.right", android: "login", web: "login" }} color={theme.colors.secondary} />
          <Text style={[local.loginText, { color: theme.colors.ink }]}>Login</Text>
        </Pressable>
      )}
    </View>
  );
}

function HeaderIcon({ name, color }: { name: any; color: string }) {
  return <SymbolView name={name} size={18} tintColor={color} fallback={<Text style={{ color, fontSize: 18, fontWeight: "700" }}>•</Text>} />;
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
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    position: "relative" as const,
  },
  loginButton: {
    minHeight: 40,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 7,
    paddingHorizontal: 13,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  loginText: { color: colors.ink, fontSize: 14, fontWeight: "800" as const },
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
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
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
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
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
