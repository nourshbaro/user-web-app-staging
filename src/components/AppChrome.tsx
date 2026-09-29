import { ReservationHoldBar } from "@/components/cart/ReservationHoldBar";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { useCart } from "@/context/CartContext";
import type { OnboardingGate } from "@/hooks/useOnboardingGate";
import { optInToPushNotifications } from "@/lib/registerPushDevice";
import { shouldShowReservationIndicator } from "@/lib/reservationIndicator";
import { router, usePathname } from "expo-router";
import { useCallback, useMemo, type PropsWithChildren } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * App-wide chrome around the navigator: the global reservation indicator
 * above every eligible screen, and the first-run onboarding overlay.
 *
 * The indicator sits in the layout flow and paints the status-bar area
 * itself; the screens below then receive a zero top inset so they do not pad
 * for the status bar twice. Nothing is overlaid on screen content.
 */
export function AppChrome({ onboarding, children }: PropsWithChildren<{ onboarding: OnboardingGate }>) {
  const pathname = usePathname();
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const showHold = shouldShowReservationIndicator({
    pathname,
    sessionId: cart.sessionId,
    itemCount: cart.items.length,
    secondsLeft: cart.secondsLeft,
    onboardingVisible: onboarding.visible,
  });
  const contentInsets = useMemo(() => (showHold ? { ...insets, top: 0 } : insets), [insets, showHold]);
  const openCart = useCallback(() => router.navigate("/cart"), []);

  return (
    <View style={local.fill}>
      <View
        style={local.fill}
        // While onboarding covers the app, the screens beneath are hidden from assistive tech.
        importantForAccessibility={onboarding.visible ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={onboarding.visible}
      >
        {showHold ? <ReservationHoldBar secondsLeft={cart.secondsLeft} topInset={insets.top} onPress={openCart} /> : null}
        <SafeAreaInsetsContext.Provider value={contentInsets}>{children}</SafeAreaInsetsContext.Provider>
      </View>
      {onboarding.visible ? (
        <OnboardingFlow
          offerNotifications={onboarding.offerNotifications}
          onTurnOnNotifications={optInToPushNotifications}
          onFinish={onboarding.complete}
        />
      ) : null}
    </View>
  );
}

const local = {
  fill: { flex: 1 },
};
