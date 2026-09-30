import { ReservationHoldBar } from "@/components/cart/ReservationHoldBar";
import { LaunchSplash } from "@/components/onboarding/LaunchSplash";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { useCart } from "@/context/CartContext";
import { useLaunchSplash } from "@/hooks/useLaunchSplash";
import type { OnboardingGate } from "@/hooks/useOnboardingGate";
import { optInToPushNotifications } from "@/lib/registerPushDevice";
import { reservationIndicatorInteractive, shouldShowReservationIndicator } from "@/lib/reservationIndicator";
import { router, usePathname } from "expo-router";
import { useCallback, useMemo, type PropsWithChildren } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * App-wide chrome around the navigator: the global reservation indicator
 * above every eligible screen, the first-run onboarding overlay, and the
 * branded launch splash on top of everything while this launch resolves.
 *
 * The indicator sits in the layout flow and paints the status-bar area
 * itself; the screens below then receive a zero top inset so they do not pad
 * for the status bar twice. Nothing is overlaid on screen content.
 */
export function AppChrome({ onboarding, children }: PropsWithChildren<{ onboarding: OnboardingGate }>) {
  const pathname = usePathname();
  const cart = useCart();
  const insets = useSafeAreaInsets();
  // Every launch: shown until the launch decision is made (and its brief beat has played).
  const splash = useLaunchSplash(!onboarding.deciding);
  const showHold = shouldShowReservationIndicator({
    pathname,
    sessionId: cart.sessionId,
    itemCount: cart.items.length,
    secondsLeft: cart.secondsLeft,
    onboardingVisible: onboarding.visible,
  });
  const contentInsets = useMemo(() => (showHold ? { ...insets, top: 0 } : insets), [insets, showHold]);
  const openCart = useCallback(() => router.navigate("/cart"), []);
  const covered = onboarding.visible || (splash.visible && !splash.leaving);

  return (
    <View style={local.fill}>
      <View
        style={local.fill}
        // While onboarding or the splash covers the app, the screens beneath are hidden from assistive tech.
        importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
        accessibilityElementsHidden={covered}
      >
        {showHold ? <ReservationHoldBar secondsLeft={cart.secondsLeft} topInset={insets.top} onPress={reservationIndicatorInteractive(pathname) ? openCart : undefined} /> : null}
        <SafeAreaInsetsContext.Provider value={contentInsets}>{children}</SafeAreaInsetsContext.Provider>
      </View>
      {onboarding.visible ? (
        <OnboardingFlow
          offerNotifications={onboarding.offerNotifications}
          onTurnOnNotifications={optInToPushNotifications}
          onFinish={onboarding.complete}
        />
      ) : null}
      {splash.visible ? <LaunchSplash leaving={splash.leaving} onHidden={splash.onHidden} /> : null}
    </View>
  );
}

const local = {
  fill: { flex: 1 },
};
