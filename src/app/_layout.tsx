import { AppChrome } from "@/components/AppChrome";
import { ThemeProvider, useTheme } from "@/components/ui";
import { AlertDialogProvider } from "@/context/AlertDialogContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { CartSheetProvider } from "@/context/CartSheetContext";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import { TicketHoldersProvider } from "@/context/TicketHoldersContext";
import { ToastProvider } from "@/context/ToastContext";
import { useAppFonts } from "@/hooks/useAppFonts";
import { useOnboardingGate } from "@/hooks/useOnboardingGate";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useSyncExternalStore } from "react";
import { getMaintenanceSnapshot, subscribeMaintenance } from "@/services/api";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  configureNotificationChannel,
  getInitialNotificationData,
  subscribeToFcmTokenRefresh,
  subscribeToNotificationResponses,
} from "@/lib/notifications";

import { MaintenanceGuard } from "@/components/maintenance/MaintenanceGuard";
import { handleNotificationNavigation } from "@/lib/notificationNavigation";
import {
  registerPushDeviceIfPermitted,
  registerRefreshedPushDevice,
} from "@/lib/registerPushDevice";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 500, fade: true });

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <ThemeProvider>
            <AuthProvider>
              <AppProviders />
            </AuthProvider>
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppProviders() {
  const theme = useTheme();
  const auth = useAuth();
  const i18n = useI18n();
  const isReady = auth.isReady && i18n.isReady;
  const fontsSettled = useAppFonts();
  const pathname = usePathname();
  const onboarding = useOnboardingGate({
    ready: isReady && fontsSettled,
    isAuthenticated: auth.isAuthenticated,
    pathname,
  });

  // Read-only: MaintenanceGuard owns what renders. When maintenance replaces the
  // navigator, the launch can never resolve, so the splash must not wait for it.
  const maintenance = useSyncExternalStore(subscribeMaintenance, getMaintenanceSnapshot, getMaintenanceSnapshot);

  useEffect(() => {
    // The native splash stays up until the first real frame is decided
    // (onboarding or the resolved initial route), so nothing flashes in between.
    if (isReady && fontsSettled && (!onboarding.deciding || maintenance)) {
      SplashScreen.hide();
    }
  }, [fontsSettled, isReady, maintenance, onboarding.deciding]);

  useEffect(() => {
    const setupNotifications = async () => {
      try {
        await configureNotificationChannel();
        // Never prompts at startup: the native permission dialog appears only
        // after an explicit "Turn on notifications" (onboarding) or the
        // Settings action. A permission granted earlier (previous launch,
        // Settings, OS default) registers exactly as before — anonymous while
        // logged out, authenticated once a session exists; AuthContext may
        // safely register the same token again.
        await registerPushDeviceIfPermitted();
      } catch (error) {
        console.error("Notification setup failed:", error);
      }
    };

    void setupNotifications();
  }, []);

  useEffect(() => {
    // One subscription for the app's lifetime, independent of login/logout,
    // since a refreshed token must still be registered anonymously while
    // logged out — sendDeviceToken() inside registerRefreshedPushDevice picks
    // anonymous vs authenticated from whatever session is current per refresh.
    const unsubscribe = subscribeToFcmTokenRefresh((nextToken) => {
      void registerRefreshedPushDevice(nextToken).catch((error) => {
        console.error("Refreshed device registration failed:", error);
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleInitialNotification = async () => {
      try {
        const data = await getInitialNotificationData();

        if (data) {
          handleNotificationNavigation(data);
        }
      } catch (error) {
        console.error("Failed to handle initial notification:", error);
      }
    };

    void handleInitialNotification();

    return subscribeToNotificationResponses(handleNotificationNavigation);
  }, []);

  if (!isReady || !fontsSettled) {
    return null;
  }

  return (
    <ToastProvider>
      <AlertDialogProvider>
        <CartProvider
          key={
            auth.isAuthenticated
              ? (auth.userCacheKey ?? "authenticated")
              : "guest"
          }
        >
          <TicketHoldersProvider>
            <CartSheetProvider>
              <StatusBar style={theme.isDark ? "light" : "dark"} />
              <MaintenanceGuard>
                <AppChrome onboarding={onboarding}>
                  <Stack
                    screenOptions={{
                      headerStyle: { backgroundColor: theme.colors.panel },
                      headerTintColor: theme.colors.ink,
                      headerShadowVisible: false,
                      contentStyle: { backgroundColor: theme.colors.bg },
                    }}
                  >
                    <Stack.Screen
                      name="index"
                      options={{ headerShown: false, animation: "none" }}
                    />
                    <Stack.Screen
                      name="matches"
                      options={{ headerShown: false, animation: "none" }}
                    />
                    <Stack.Screen
                      name="competitions"
                      options={{ headerShown: false, animation: "none" }}
                    />
                    {/* Legacy primary route: redirects to /competitions for old links. */}
                    <Stack.Screen
                      name="tournament"
                      options={{ headerShown: false, animation: "none" }}
                    />
                    <Stack.Screen name="auth" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="profile"
                      options={{ headerShown: false, animation: "none" }}
                    />
                    <Stack.Screen
                      name="tickets"
                      options={{ headerShown: false, animation: "none" }}
                    />
                    <Stack.Screen
                      name="edit-profile"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen name="about" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="settings"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen name="cart" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="checkout"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="checkout/ticket-holders"
                      options={{ headerShown: false, presentation: "card" }}
                    />
                    <Stack.Screen
                      name="checkout/card/payment"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="checkout/blue/payment"
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="match/[id]"
                      options={{ headerShown: false }}
                    />
                  </Stack>
                </AppChrome>
              </MaintenanceGuard>
            </CartSheetProvider>
          </TicketHoldersProvider>
        </CartProvider>
      </AlertDialogProvider>
    </ToastProvider>
  );
}
