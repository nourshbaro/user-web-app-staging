import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/components/ui";
import { HeaderActions } from "@/components/HeaderActions";
import { CartTimerPill } from "@/components/CartTimer";
import { useCart } from "@/context/CartContext";
import { DirectionalChevron } from "@/components/foundation";
import { useI18n } from "@/i18n/I18nProvider";

export function AppHeader({
  title,
  subtitle,
  showBack = true,
  hideCart = false,
  onBack,
  showTimer = false,
  showCartWithTimer = false,
  backDisabled = false,
}: {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  hideCart?: boolean;
  onBack?: () => void;
  showTimer?: boolean;
  showCartWithTimer?: boolean;
  /** Back is temporarily unavailable (e.g. a payment is being submitted). */
  backDisabled?: boolean;
}) {
  const theme = useTheme();
  const cart = useCart();
  const { t } = useI18n();
  const handleBack = () => {
    if (backDisabled) return;
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
          <Pressable onPress={handleBack} disabled={backDisabled} accessibilityRole="button" accessibilityLabel={t("common.back")} accessibilityState={{ disabled: backDisabled }} aria-disabled={backDisabled} hitSlop={4} style={[local.iconButton, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }, backDisabled && { opacity: 0.4 }]}>
            <DirectionalChevron kind="back" size={18} color={theme.colors.ink} />
          </Pressable>
        ) : null}
        <View style={local.copy}>
          <Text numberOfLines={1} style={[local.title, { color: theme.colors.ink }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={theme.styles.muted}>{subtitle}</Text> : null}
        </View>
      </View>
      {showCartWithTimer ? (
        <HeaderActions onCartPress={() => router.navigate("/cart")} />
      ) : showTimer && cart.sessionId ? (
        <CartTimerPill seconds={cart.secondsLeft} />
      ) : (
        <HeaderActions hideCart={hideCart} />
      )}
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
  title: { fontSize: 18, fontWeight: "900" as const },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
