import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import { ToastProvider } from "@/context/ToastContext";
import { ThemeProvider, useTheme } from "@/components/ui";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppProviders />
    </ThemeProvider>
  );
}

function AppProviders() {
  const theme = useTheme();

  return (
    <AuthProvider>
      <CartProvider>
        <ToastProvider>
          <StatusBar style={theme.isDark ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.panel },
              headerTintColor: theme.colors.ink,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: theme.colors.bg },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="auth" options={{ headerShown: false }} />
            <Stack.Screen name="profile" options={{ headerShown: false }} />
            <Stack.Screen name="cart" options={{ headerShown: false }} />
            <Stack.Screen name="checkout" options={{ headerShown: false }} />
            <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
          </Stack>
        </ToastProvider>
      </CartProvider>
    </AuthProvider>
  );
}
