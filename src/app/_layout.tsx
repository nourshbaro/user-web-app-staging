import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { CartSheetProvider } from "@/context/CartSheetContext";
import { ToastProvider } from "@/context/ToastContext";
import { ThemeProvider, useTheme } from "@/components/ui";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 500, fade: true });

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppProviders />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppProviders() {
  const theme = useTheme();
  const auth = useAuth();

  useEffect(() => {
    if (auth.isReady) SplashScreen.hide();
  }, [auth.isReady]);

  if (!auth.isReady) return null;

  return (
    <CartProvider>
      <ToastProvider>
        <CartSheetProvider>
            <StatusBar style={theme.isDark ? "light" : "dark"} />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: theme.colors.panel },
                headerTintColor: theme.colors.ink,
                headerShadowVisible: false,
                contentStyle: { backgroundColor: theme.colors.bg },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false, animation: "none" }} />
              <Stack.Screen name="matches" options={{ headerShown: false, animation: "none" }} />
              <Stack.Screen name="tournament" options={{ headerShown: false, animation: "none" }} />
              <Stack.Screen name="auth" options={{ headerShown: false }} />
              <Stack.Screen name="profile" options={{ headerShown: false, animation: "none" }} />
              <Stack.Screen name="tickets" options={{ headerShown: false, animation: "none" }} />
              <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
              <Stack.Screen name="about" options={{ headerShown: false }} />
              <Stack.Screen name="settings" options={{ headerShown: false }} />
              <Stack.Screen name="cart" options={{ headerShown: false }} />
              <Stack.Screen name="checkout" options={{ headerShown: false }} />
              <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
            </Stack>
        </CartSheetProvider>
      </ToastProvider>
    </CartProvider>
  );
}
