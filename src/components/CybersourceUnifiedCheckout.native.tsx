import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useTheme } from "@/components/ui";
import { config } from "@/lib/config";

const CHECKOUT_INITIAL_HEIGHT = 520;
const CHECKOUT_MAX_HEIGHT = 2200;

type Props = {
  captureContext: string;
  onSuccess: (token: string) => void;
  onError: (message: string) => void;
};

type CheckoutMessage =
  | { type: "ready" }
  | { type: "height"; height?: number }
  | { type: "success"; token?: string }
  | { type: "error"; message?: string };

function jsStringLiteral(value: string) {
  return JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
}

function buildCheckoutHtml(captureContext: string) {
  const safeCaptureContext = jsStringLiteral(captureContext);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #151a2c;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        width: 100%;
        overflow: hidden;
      }
      #uc-payment-buttons {
        min-height: 420px;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <div id="uc-payment-buttons"></div>
    <script>
      const post = (payload) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      const reportHeight = () => {
        const contentBottom = Array.from(document.body.querySelectorAll('*')).reduce((bottom, element) => {
          const rect = element.getBoundingClientRect();
          return Math.max(bottom, rect.bottom + window.scrollY);
        }, 0);
        const height = Math.ceil(Math.max(
          ${CHECKOUT_INITIAL_HEIGHT},
          contentBottom,
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        ));
        post({ type: "height", height });
      };
      new ResizeObserver(reportHeight).observe(document.documentElement);
      new MutationObserver(reportHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
      window.addEventListener("load", reportHeight);
      const fail = (error) => {
        const message = error && (error.reason || error.message) ? (error.reason || error.message) : "Payment could not be completed. Please try again.";
        post({ type: "error", message });
      };

      window.addEventListener("error", (event) => fail(event.error || new Error(event.message)));

      async function initCheckout() {
        try {
          if (!window.VAS) throw new Error("Cybersource SDK is not ready.");

          const client = await window.VAS.UnifiedCheckout(${safeCaptureContext});
          const checkout = await client.createCheckout({ autoProcessing: false });
          post({ type: "ready" });
          reportHeight();

          const transientToken = await checkout.mount("#uc-payment-buttons");
          post({ type: "success", token: transientToken });
          checkout.destroy();
          client.destroy();
        } catch (error) {
          fail(error);
        }
      }
    </script>
    <script src="${config.cybersourceUnifiedCheckoutUrl}" async onload="initCheckout()" onerror="fail(new Error('Could not load the payment SDK. Check your connection and try again.'))"></script>
  </body>
</html>`;
}

export function CybersourceUnifiedCheckout({ captureContext, onSuccess, onError }: Props) {
  const theme = useTheme();
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const completedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [webViewHeight, setWebViewHeight] = useState(CHECKOUT_INITIAL_HEIGHT);
  const [attempt, setAttempt] = useState(0);
  const html = useMemo(() => buildCheckoutHtml(captureContext), [captureContext]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    completedRef.current = false;
    const resetTimer = setTimeout(() => {
      setStatus("loading");
      setError(null);
      setWebViewHeight(CHECKOUT_INITIAL_HEIGHT);
      setAttempt(0);
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [captureContext]);

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: CheckoutMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as CheckoutMessage;
    } catch {
      return;
    }

    if (message.type === "ready") {
      setStatus("ready");
      return;
    }

    if (message.type === "height" && Number.isFinite(message.height)) {
      setWebViewHeight(Math.max(CHECKOUT_INITIAL_HEIGHT, Math.min(CHECKOUT_MAX_HEIGHT, Number(message.height))));
      return;
    }

    if (message.type === "success" && message.token && !completedRef.current) {
      completedRef.current = true;
      onSuccessRef.current(message.token);
      return;
    }

    if (message.type === "error") {
      const nextError = message.message ?? "Payment could not be completed. Please try again.";
      setStatus("error");
      setError(nextError);
      onErrorRef.current(nextError);
    }
  };

  return (
    <View style={local.wrap}>
      <View style={local.heading}>
        <View style={[local.secureMark, { backgroundColor: theme.colors.success }]}>
          <Text style={local.secureMarkText}>✓</Text>
        </View>
        <View style={local.headingCopy}>
          <Text style={[local.title, { color: theme.colors.ink }]}>Secure card payment</Text>
          <Text style={[local.subtitle, { color: theme.colors.muted }]}>Your card details are encrypted and sent directly to our payment partner.</Text>
        </View>
      </View>

      <View style={[local.frame, { borderColor: theme.colors.line, backgroundColor: theme.colors.panel }]}>
        {status !== "error" ? (
          <WebView
            key={`${captureContext}-${attempt}`}
            originWhitelist={["https://*", "http://*"]}
            source={{ html, baseUrl: config.siteUrl || "https://api-lfa.matrixvert.com" }}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="never"
            onMessage={handleMessage}
            scrollEnabled={false}
            style={[local.webview, { height: webViewHeight, opacity: status === "ready" ? 1 : 0 }]}
          />
        ) : null}

        {status === "loading" ? (
          <View style={[local.loading, { backgroundColor: theme.colors.panel }]}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[local.loadingTitle, { color: theme.colors.ink }]}>Opening secure checkout</Text>
            <Text style={[local.loadingText, { color: theme.colors.muted }]}>This usually takes a few seconds.</Text>
            <View style={local.skeletonStack}>
              <View style={[local.skeletonWide, { backgroundColor: theme.colors.panelSoft }]} />
              <View style={local.skeletonRow}>
                <View style={[local.skeletonHalf, { backgroundColor: theme.colors.panelSoft }]} />
                <View style={[local.skeletonHalf, { backgroundColor: theme.colors.panelSoft }]} />
              </View>
              <View style={[local.skeletonButton, { backgroundColor: theme.colors.panelSoft }]} />
            </View>
          </View>
        ) : null}

        {status === "error" ? (
          <View style={local.errorState}>
            <Text style={[local.errorTitle, { color: theme.colors.ink }]}>We couldn’t open the payment form</Text>
            <Text style={[local.errorText, { color: theme.colors.muted }]}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                completedRef.current = false;
                setError(null);
                setStatus("loading");
                setWebViewHeight(CHECKOUT_INITIAL_HEIGHT);
                setAttempt((value) => value + 1);
              }}
              style={({ pressed }) => [local.retryButton, { backgroundColor: theme.colors.primary }, pressed && local.pressed]}
            >
              <Text style={local.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Text style={[local.footer, { color: theme.colors.muted }]}>Payments processed securely by Cybersource</Text>
    </View>
  );
}

const local = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 520, alignSelf: "center", gap: 14 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  headingCopy: { flex: 1, gap: 3 },
  secureMark: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  secureMarkText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  title: { fontSize: 16, lineHeight: 21, fontWeight: "900" },
  subtitle: { fontSize: 12, lineHeight: 17 },
  frame: { width: "100%", minHeight: CHECKOUT_INITIAL_HEIGHT, overflow: "hidden", borderWidth: 1, borderRadius: 18 },
  webview: { width: "100%", backgroundColor: "#FFFFFF" },
  loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: 24, alignItems: "center", justifyContent: "center" },
  loadingTitle: { marginTop: 14, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  loadingText: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  skeletonStack: { width: "100%", marginTop: 28, gap: 12 },
  skeletonWide: { height: 54, borderRadius: 12 },
  skeletonRow: { flexDirection: "row", gap: 10 },
  skeletonHalf: { flex: 1, height: 54, borderRadius: 12 },
  skeletonButton: { height: 48, marginTop: 4, borderRadius: 12 },
  errorState: { minHeight: CHECKOUT_INITIAL_HEIGHT, padding: 28, alignItems: "center", justifyContent: "center" },
  errorTitle: { fontSize: 17, lineHeight: 23, fontWeight: "900", textAlign: "center" },
  errorText: { maxWidth: 360, marginTop: 7, fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryButton: { minHeight: 44, marginTop: 20, paddingHorizontal: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.82 },
  footer: { fontSize: 11, lineHeight: 16, textAlign: "center" },
});
