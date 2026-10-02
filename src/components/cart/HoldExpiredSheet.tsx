import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { holdExpiredMessageKey, holdRestartRoute } from "@/lib/holdExpiry";
import { setPrimaryTabTransitionDirection } from "@/lib/navigationPresentation";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Animated, Easing, Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * v3 "Reservation expired" (hold_expired) sheet. Presentation only: it reads
 * the snapshot `CartContext` captured before clearing the expired session
 * (`expiredHold`) and never touches the cart. By the time it shows, the owner
 * has already dismissed every transaction screen and returned to Home.
 *
 * - Start again → the one match's Match Details (a clean selection), or
 *   Matches on Upcoming for a hold that spanned several matches.
 * - Back to home → stays on Home (Android back does the same).
 */
export function HoldExpiredSheet() {
  const cart = useCart();
  const hold = cart.expiredHold;
  const theme = useTheme();
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [rise] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!hold) return;
    if (reducedMotion) {
      rise.setValue(0);
      return;
    }
    // v3 `lfSheet .44s cubic-bezier(.32,.72,0,1)`: the sheet rises; the scrim fades (Modal).
    rise.setValue(1);
    const animation = Animated.timing(rise, { toValue: 0, duration: 440, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [hold, reducedMotion, rise]);

  if (!hold) return null;

  // Both actions start from a clean Home stack: a transaction screen's own
  // empty-cart guard may have navigated after the owner's reset to Home.
  const resetToHome = () => {
    // Only pop when there is a stack to pop (POP_TO_TOP at the root is unhandled).
    if (router.canDismiss()) router.dismissAll();
    router.replace("/");
  };
  const backToHome = () => {
    cart.dismissExpiredHold();
    resetToHome();
  };
  const startAgain = () => {
    const route = holdRestartRoute(hold);
    cart.dismissExpiredHold();
    resetToHome();
    if (route === "/matches") {
      // Same semantics as the bottom tab (Matches opens on Upcoming).
      setPrimaryTabTransitionDirection(1);
      router.replace(route);
    } else {
      // Match Details over Home; Back returns Home. Nothing is re-reserved.
      router.push(route);
    }
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={backToHome}>
      <View style={[local.scrim, { backgroundColor: "rgba(0,0,0,0.45)" }]}>
        <Animated.View
          accessibilityViewIsModal
          style={[
            local.sheet,
            {
              backgroundColor: theme.colors.background,
              paddingBottom: Math.max(insets.bottom, 12) + 22,
              boxShadow: "0px -10px 40px rgba(0,0,0,0.2)",
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, 420] }) }],
            },
          ]}
        >
          <View style={[local.handle, { backgroundColor: theme.colors.border }]} accessible={false} />
          <View style={[local.icon, { backgroundColor: theme.colors.tones.brand.bg }]} accessible={false} importantForAccessibility="no-hide-descendants">
            <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" } as never} size={30} tintColor={theme.colors.actionPrimary} fallback={<View />} />
          </View>
          <AppText variant="displaySheet" align="center" accessibilityRole="header" style={local.title}>
            {i18n.t("holdExpired.title")}
          </AppText>
          <AppText variant="body" tone="muted" align="center" style={local.message}>
            {i18n.t(holdExpiredMessageKey(hold))}
          </AppText>
          <View style={local.actions}>
            <Button title={i18n.t("holdExpired.startAgain")} onPress={startAgain} accessibilityHint={i18n.t(hold.matchIds.length === 1 ? "holdExpired.startAgainMatchHint" : "holdExpired.startAgainMatchesHint")} />
            <Button title={i18n.t("holdExpired.home")} variant="ghost" onPress={backToHome} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const local = {
  scrim: { flex: 1, justifyContent: "flex-end" as const },
  // v3: radius 28 28 0 0, padding 8 20 34, centred.
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, paddingHorizontal: 20, alignItems: "center" as const },
  handle: { width: 36, height: 5, borderRadius: 3, marginBottom: 24 },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center" as const, justifyContent: "center" as const },
  title: { fontSize: 32, lineHeight: 34, marginTop: 18 },
  message: { marginTop: 10, maxWidth: 420 },
  actions: { alignSelf: "stretch" as const, marginTop: 26, gap: 4, maxWidth: 560, width: "100%" as const, marginHorizontal: "auto" as const },
};
