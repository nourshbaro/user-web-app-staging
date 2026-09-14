import { AppHeader } from "@/components/AppHeader";
import { Button, useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import {
  clearBluePaymentHandoff,
  clearPendingBluePaymentAttempt,
  readBluePaymentHandoff,
} from "@/lib/bluePaymentHandoff";
import { blueResultDisplayParams, decideBlueNavigation } from "@/lib/bluePaymentRedirect";
import { config } from "@/lib/config";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function BluePaymentScreen() {
  const theme = useTheme();
  const cart = useCart();
  const toast = useToast();
  const alertDialog = useAlertDialog();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ handoff?: string | string[] }>();
  const handoffId = firstParam(params.handoff) ?? "";
  const [handoff] = useState(() => readBluePaymentHandoff(handoffId));
  const paymentUrl = handoff?.paymentUrl ?? null;
  const terminalHandledRef = useRef(false);
  const activeRef = useRef(true);
  const [loading, setLoading] = useState(Boolean(paymentUrl));
  const [error, setError] = useState<string | null>(
    paymentUrl ? null : "This payment session is no longer available.",
  );

  // BLUE may be processing remotely when the user leaves, so confirm the
  // navigation. The local reservation deliberately remains active until a
  // trusted success callback or the CartContext expiry authority clears it.
  const confirmLeave = useCallback(() => {
    void alertDialog.showAlert({
      title: "Leave payment?",
      message: "Your reservation remains active until its timer expires. You can return to Checkout and try again.",
      variant: "confirm",
      cancelLabel: "Stay",
      confirmLabel: "Leave",
    }).then((leave) => {
      if (!leave) return;
      clearBluePaymentHandoff(handoffId);
      router.dismissTo("/checkout");
    });
  }, [alertDialog, handoffId]);

  useEffect(() => {
    activeRef.current = true;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmLeave();
      return true;
    });
    return () => {
      activeRef.current = false;
      subscription.remove();
      clearBluePaymentHandoff(handoffId);
    };
  }, [confirmLeave, handoffId]);

  const handleTerminal = useCallback(async (terminalUrl: string, result: "success" | "failed") => {
    if (!activeRef.current || terminalHandledRef.current) return;
    terminalHandledRef.current = true;
    const displayParams = blueResultDisplayParams(terminalUrl);
    if (result === "failed") {
      clearBluePaymentHandoff(handoffId);
      toast.showToast({
        variant: "error",
        title: "Payment was not completed",
        message: "Your reservation is still active. You can try again before the timer expires.",
      });
      router.dismissTo("/checkout");
      return;
    }
    const ticket = cart.captureCartSession();
    if (!handoff || !ticket || ticket.sessionId !== handoff.sessionId) return;
    const cleared = await cart.clearCartIfSession(ticket);
    if (!cleared || !activeRef.current) return;
    clearPendingBluePaymentAttempt(handoff.sessionId);
    clearBluePaymentHandoff(handoffId);
    const resetRouter = router as typeof router & { dismissAll?: () => void };
    resetRouter.dismissAll?.();
    router.replace({
      pathname: "/checkout/success",
      params: { provider: "blue", ...displayParams },
    });
  }, [cart, handoff, handoffId, toast]);

  const handleNavigation = useCallback((request: WebViewNavigation) => {
    const navigationUrl = request.url;
    const navigationDecision = decideBlueNavigation(
      navigationUrl,
      config.blueRedirectOrigin,
      terminalHandledRef.current,
    );
    const { terminalResult } = navigationDecision;

    if (navigationDecision.action === "ignore") {
      return false;
    }

    if (navigationDecision.action === "handle_terminal" && terminalResult) {
      handleTerminal(navigationUrl, terminalResult);
      return false;
    }

    if (navigationDecision.decision === "invalid_url") {
      setError("The payment page tried to open an invalid address.");
      return false;
    }

    if (navigationDecision.decision === "blocked_credentials") {
      setError("The payment page tried to open an unsafe address.");
      return false;
    }
    if (navigationDecision.action === "allow_webview") {
      return true;
    }

    if (navigationDecision.action === "open_external") {
      const externalUrl = new URL(navigationUrl);
      void Linking.canOpenURL(externalUrl.href)
        .then((supported) => {
          if (!supported) {
            return;
          }
          return Linking.openURL(externalUrl.href);
        })
        .catch(() => {
          setError("This external action is not available on this device.");
        });
      return false;
    }

    if (navigationDecision.decision === "blocked_dangerous_scheme") {
      setError("This payment-page action is not supported inside the app.");
      return false;
    }

    setError("The payment page requested an unsupported external application.");
    return false;
  }, [handleTerminal]);

  const handleShouldStart = useCallback(
    (request: WebViewNavigation) => handleNavigation(request),
    [handleNavigation],
  );

  const showUnavailable = (message: string) => {
    setLoading(false);
    setError(message);
  };

  return (
    <View
      style={[
        local.screen,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
          animation: "none",
        }}
      />

      <View style={local.header}>
        <AppHeader title="BLUE Payment" subtitle="Secure payment" hideCart showTimer onBack={confirmLeave} />
      </View>

      <View style={local.paymentArea}>
        {paymentUrl && !error ? (
          <WebView
          source={{ uri: paymentUrl }}
          originWhitelist={["*"]}
          javaScriptEnabled
          mixedContentMode="never"
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={handleShouldStart}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => showUnavailable("The Blue payment page could not be loaded.")}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 400) {
              showUnavailable("The Blue payment page returned an error.");
            }
          }}
          onRenderProcessGone={() => showUnavailable("The Android payment renderer stopped.")}
          onContentProcessDidTerminate={() => showUnavailable("The iOS payment process stopped.")}
          style={local.webView}
          />
        ) : null}

        {loading && !error ? (
          <View style={[local.overlay, { backgroundColor: theme.colors.panel }]}>
          <ActivityIndicator color={theme.colors.primary} />
          <Text style={[local.loadingTitle, { color: theme.colors.ink }]}>Opening Blue Wallet</Text>
          <Text style={[local.message, { color: theme.colors.muted }]}>Please wait while the payment page loads.</Text>
          </View>
        ) : null}

        {error ? (
          <View style={[local.overlay, { backgroundColor: theme.colors.panel }]}>
          <Text accessibilityRole="alert" style={[local.errorTitle, { color: theme.colors.ink }]}>Payment unavailable</Text>
          <Text style={[local.message, { color: theme.colors.muted }]}>
            {error} Your reservation remains available while its timer is active.
          </Text>
          <Button title="Return to Checkout" onPress={() => { clearBluePaymentHandoff(handoffId); router.dismissTo("/checkout"); }} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 14 },
  paymentArea: { flex: 1 },
  webView: { flex: 1, backgroundColor: "#FFFFFF" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: 28, alignItems: "center", justifyContent: "center" },
  loadingTitle: { marginTop: 14, fontSize: 17, lineHeight: 23, fontWeight: "900", textAlign: "center" },
  errorTitle: { fontSize: 20, lineHeight: 27, fontWeight: "900", textAlign: "center" },
  message: { maxWidth: 420, marginTop: 7, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
