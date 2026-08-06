import { useTheme } from "@/components/ui";
import { clearBluePaymentHandoff, readBluePaymentHandoff } from "@/lib/bluePaymentHandoff";
import {
  createBlueNavigationDiagnostic,
  logBlueNavigationDiagnostic,
  type BlueNavigationDecision,
} from "@/lib/bluePaymentNavigationDiagnostics";
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

function readIsTopFrame(request: WebViewNavigation) {
  const candidate = request as WebViewNavigation & { isTopFrame?: unknown };
  return typeof candidate.isTopFrame === "boolean" ? candidate.isTopFrame : undefined;
}

export default function BluePaymentScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ handoff?: string | string[] }>();
  const handoffId = firstParam(params.handoff) ?? "";
  const [paymentUrl] = useState(() => readBluePaymentHandoff(handoffId)?.paymentUrl ?? null);
  const terminalHandledRef = useRef(false);
  const activeRef = useRef(true);
  const [loading, setLoading] = useState(Boolean(paymentUrl));
  const [error, setError] = useState<string | null>(
    paymentUrl ? null : "This payment session is no longer available.",
  );

  useEffect(() => {
    activeRef.current = true;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => {
      activeRef.current = false;
      subscription.remove();
      clearBluePaymentHandoff(handoffId);
    };
  }, [handoffId]);

  const handleTerminal = useCallback((terminalUrl: string, result: "success" | "failed") => {
    if (!activeRef.current || terminalHandledRef.current) return;
    terminalHandledRef.current = true;
    const displayParams = blueResultDisplayParams(terminalUrl);
    clearBluePaymentHandoff(handoffId);
    router.replace({
      pathname: result === "success" ? "/checkout/success" : "/checkout/failed",
      params: { provider: "blue", ...displayParams },
    });
  }, [handoffId]);

  const handleNavigation = useCallback((request: WebViewNavigation) => {
    const navigationUrl = request.url;
    const navigationDecision = decideBlueNavigation(
      navigationUrl,
      config.blueRedirectOrigin,
      terminalHandledRef.current,
    );
    const { terminalResult } = navigationDecision;
    const logDecision = (
      decision: BlueNavigationDecision,
      callback = "onShouldStartLoadWithRequest",
    ) => {
      logBlueNavigationDiagnostic(createBlueNavigationDiagnostic(navigationUrl, {
        callback,
        navigationType: request.navigationType,
        isTopFrame: readIsTopFrame(request),
        terminalResult,
        terminalAlreadyHandled: terminalHandledRef.current,
        decision,
      }));
    };

    logDecision("navigation_received");

    if (navigationDecision.action === "ignore") {
      logDecision(navigationDecision.decision);
      return false;
    }

    if (navigationDecision.action === "handle_terminal" && terminalResult) {
      logDecision(navigationDecision.decision);
      handleTerminal(navigationUrl, terminalResult);
      return false;
    }

    if (navigationDecision.decision === "invalid_url") {
      logDecision(navigationDecision.decision);
      setError("The payment page tried to open an invalid address.");
      return false;
    }

    if (navigationDecision.decision === "blocked_credentials") {
      logDecision(navigationDecision.decision);
      setError("The payment page tried to open an unsafe address.");
      return false;
    }
    if (navigationDecision.action === "allow_webview") {
      logDecision(navigationDecision.decision);
      return true;
    }

    if (navigationDecision.action === "open_external") {
      const externalUrl = new URL(navigationUrl);
      logDecision(navigationDecision.decision, "Linking.canOpenURL");
      void Linking.canOpenURL(externalUrl.href)
        .then((supported) => {
          if (!supported) {
            logDecision("external_open_failed", "Linking.canOpenURL");
            return;
          }
          return Linking.openURL(externalUrl.href)
            .then(() => logDecision("open_external_supported", "Linking.openURL"));
        })
        .catch(() => {
          logDecision("external_open_failed", "Linking.openURL");
          setError("This external action is not available on this device.");
        });
      return false;
    }

    if (navigationDecision.decision === "blocked_dangerous_scheme") {
      logDecision(navigationDecision.decision);
      setError("This payment-page action is not supported inside the app.");
      return false;
    }

    logDecision(navigationDecision.decision);
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
            {error} Close and reopen the app to return to the normal startup flow.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const local = StyleSheet.create({
  screen: { flex: 1 },
  webView: { flex: 1, backgroundColor: "#FFFFFF" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: 28, alignItems: "center", justifyContent: "center" },
  loadingTitle: { marginTop: 14, fontSize: 17, lineHeight: 23, fontWeight: "900", textAlign: "center" },
  errorTitle: { fontSize: 20, lineHeight: 27, fontWeight: "900", textAlign: "center" },
  message: { maxWidth: 420, marginTop: 7, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
