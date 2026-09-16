import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { CartSheetProvider } from "@/context/CartSheetContext";
import { TicketHoldersProvider } from "@/context/TicketHoldersContext";
import { ToastProvider } from "@/context/ToastContext";
import { AlertDialogProvider } from "@/context/AlertDialogContext";
import { ThemeProvider, useTheme } from "@/components/ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import * as Notifications from "expo-notifications";

import {
  configureNotificationChannel,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  subscribeToFcmTokenRefresh,
} from "@/lib/notifications";

import { handleNotificationNavigation } from "@/lib/notificationNavigation";
import { registerPushDevice, registerRefreshedPushDevice } from "@/lib/registerPushDevice";
import { MaintenanceGuard } from "@/components/maintenance/MaintenanceGuard";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 500, fade: true });

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
       <ThemeProvider>
        <AuthProvider>
          <AppProviders />
        </AuthProvider>
       </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppProviders() {
  const theme = useTheme();
  const auth = useAuth();

  useEffect(() => {
    if (auth.isReady) {
      SplashScreen.hide();
    }
  }, [auth.isReady]);

useEffect(() => {
  const setupNotifications = async () => {
    try {
      await configureNotificationChannel();

      const currentPermission =
        await getNotificationPermissionStatus();

      const resolvedPermission =
        currentPermission === "undetermined"
          ? await requestNotificationPermission()
          : currentPermission;

      if (resolvedPermission === "granted") {
        // Registers with whatever session is current right now — anonymous
        // while logged out, authenticated once a session exists. Covers
        // both a permission already granted from a previous launch and one
        // just granted through the dialog above; registerPushDevice() is
        // safe to call again from AuthContext for the same token.
        await registerPushDevice();
      }
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
      const response =
        await Notifications.getLastNotificationResponseAsync();

      if (!response) {
        return;
      }

      const data =
        response.notification.request.content.data;

      if (data && typeof data === "object") {
        handleNotificationNavigation(data);
      }
    } catch (error) {
      console.error(
        "Failed to handle initial notification:",
        error,
      );
    }
  };

  void handleInitialNotification();

  const responseSubscription =
    Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data =
          response.notification.request.content.data;

        if (data && typeof data === "object") {
          handleNotificationNavigation(data);
        }
      },
    );

  return () => {
    responseSubscription.remove();
  };
}, []);

  if (!auth.isReady) {
    return null;
  }

  return (
    <ToastProvider>
      <AlertDialogProvider>
      <CartProvider key={auth.isAuthenticated ? auth.userCacheKey ?? "authenticated" : "guest"}>
        <TicketHoldersProvider>
        <CartSheetProvider>
          <StatusBar style={theme.isDark ? "light" : "dark"} />
          <MaintenanceGuard>
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
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="cart" options={{ headerShown: false }} />
            <Stack.Screen name="checkout" options={{ headerShown: false }} />
            <Stack.Screen
              name="checkout/ticket-holders"
              options={{ headerShown: false, presentation: "card" }}
            />
            <Stack.Screen name="checkout/card/payment" options={{ headerShown: false }} />
            <Stack.Screen name="checkout/blue/payment" options={{ headerShown: false }} />
            <Stack.Screen
              name="match/[id]"
              options={{ headerShown: false }}
            />
            </Stack>
          </MaintenanceGuard>
        </CartSheetProvider>
        </TicketHoldersProvider>
      </CartProvider>
      </AlertDialogProvider>
    </ToastProvider>
  );
}
