import { translate } from "@/i18n/runtime";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/components/ui";
import { config } from "@/lib/config";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

const CHECKOUT_LOADING_HEIGHT = 320;
const CHECKOUT_MAX_HEIGHT = 2200;

type Props = {
  captureContext: string;
  onSuccess: (token: string) => void;
  onError: (message: string) => void;
  fullscreen?: boolean;
};

type CheckoutMessage =
  | { type: "ready" }
  | { type: "height"; height?: number }
  | { type: "success"; token?: string }
  | { type: "error"; message?: string; reason?: "sdk_load_failed" };

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
        min-height: 100%;
        overflow: auto;
      }
      #uc-payment-buttons,
      #uc-payment-form {
        width: 100%;
        max-width: none;
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    <div id="uc-payment-buttons"></div>
    <div id="uc-payment-form"></div>
    <script>
      const post = (payload) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      const checkoutContainers = () => [
        document.getElementById("uc-payment-buttons"),
        document.getElementById("uc-payment-form")
      ].filter(Boolean);
      let animationFrame = 0;
      let lastReportedHeight = 0;
      let readyPosted = false;
      let resizeObserver;
      let mutationObserver;

      const measureCheckout = () => {
        animationFrame = 0;
        const containers = checkoutContainers();
        const contentBottom = containers.reduce((bottom, element) => {
          const rect = element.getBoundingClientRect();
          if (!rect.width && !rect.height && !element.scrollHeight) return bottom;
          const top = rect.top + window.scrollY;
          return Math.max(bottom, top + Math.max(rect.height, element.scrollHeight));
        }, 0);
        const height = Math.ceil(contentBottom);
        if (height > 0 && height !== lastReportedHeight) {
          lastReportedHeight = height;
          post({ type: "height", height });
        }
        if (!readyPosted && height > 0 && containers.some((element) => element.childElementCount > 0)) {
          readyPosted = true;
          post({ type: "ready" });
        }
      };
      const scheduleMeasurement = () => {
        if (animationFrame) return;
        animationFrame = requestAnimationFrame(measureCheckout);
      };
      const markReady = () => {
        if (!readyPosted) {
          readyPosted = true;
          post({ type: "ready" });
        }
        scheduleMeasurement();
      };
      const observeCheckout = () => {
        const containers = checkoutContainers();
        resizeObserver = new ResizeObserver(scheduleMeasurement);
        mutationObserver = new MutationObserver(scheduleMeasurement);
        containers.forEach((element) => {
          resizeObserver.observe(element);
          mutationObserver.observe(element, { childList: true, subtree: true, attributes: true });
        });
        scheduleMeasurement();
      };
      const stopObservingCheckout = () => {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        resizeObserver && resizeObserver.disconnect();
        mutationObserver && mutationObserver.disconnect();
      };
      window.addEventListener("load", scheduleMeasurement);
      const fail = (error) => {
        // The native wrapper resolves UI copy in the current app language.
        post({ type: "error" });
      };
      const sdkLoadFailed = () => post({ type: "error", reason: "sdk_load_failed" });

      window.addEventListener("error", (event) => fail(event.error || new Error(event.message)));

      async function initCheckout() {
        try {
          if (!window.VAS) throw new Error("payment_sdk_unavailable");

          const client = await window.VAS.UnifiedCheckout(${safeCaptureContext});
          const checkout = await client.createCheckout({ autoProcessing: true });
          observeCheckout();
          if (typeof checkout.on === "function") checkout.on("ready", markReady);

          try {
            const tokenPromise = checkout.mount({
              paymentSelection: "#uc-payment-buttons",
              paymentScreen: "#uc-payment-form"
            });
            requestAnimationFrame(() => requestAnimationFrame(markReady));
            const transientToken = await tokenPromise;
            post({ type: "success", token: transientToken });
          } finally {
            stopObservingCheckout();
            try {
              checkout.destroy();
            } finally {
              client.destroy();
            }
          }
        } catch (error) {
          stopObservingCheckout();
          fail(error);
        }
      }
    </script>
    <script src="${config.cybersourceUnifiedCheckoutUrl}" async onload="initCheckout()" onerror="sdkLoadFailed()"></script>
  </body>
</html>`;
}

export function CybersourceUnifiedCheckout({ captureContext, onSuccess, onError, fullscreen = false }: Props) {
  const theme = useTheme();
  const { t } = useI18n();
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const completedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [webViewHeight, setWebViewHeight] = useState(CHECKOUT_LOADING_HEIGHT);
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
      setWebViewHeight(CHECKOUT_LOADING_HEIGHT);
      setAttempt(0);
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [captureContext]);

  useEffect(() => {
    if (status !== "loading") return;
    const timeout = setTimeout(() => {
      const message = translate("payment.card.prepareFailed");
      setStatus("error");
      setError(message);
      onErrorRef.current(message);
    }, 20000);
    return () => clearTimeout(timeout);
  }, [attempt, status]);

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

    if (
      message.type === "height"
      && typeof message.height === "number"
      && Number.isFinite(message.height)
      && message.height > 0
      && message.height <= CHECKOUT_MAX_HEIGHT
    ) {
      setWebViewHeight(Math.ceil(message.height));
      return;
    }

    if (message.type === "success" && message.token && !completedRef.current) {
      completedRef.current = true;
      onSuccessRef.current(message.token);
      return;
    }

    if (message.type === "error") {
      const nextError = message.reason === "sdk_load_failed"
        ? translate("payment.form.sdkFailed")
        : message.message ?? translate("payment.form.generic");
      setStatus("error");
      setError(nextError);
      onErrorRef.current(nextError);
    }
  };

  return (
    <View style={[local.wrap, fullscreen && local.fullscreenWrap]}>
      {/* <View style={local.heading}>
        <View style={[local.secureMark, { backgroundColor: theme.colors.success }]}>
          <Text style={local.secureMarkText}>✓</Text>
        </View>
        <View style={local.headingCopy}>
          <Text style={[local.title, { color: theme.colors.ink }]}>Secure card payment</Text>
          <Text style={[local.subtitle, { color: theme.colors.muted }]}>Your card details are encrypted and sent directly to our payment partner.</Text>
        </View>
      </View> */}

      <View style={[local.frame, fullscreen && local.fullscreenFrame, { borderColor: theme.colors.line, backgroundColor: theme.colors.panel }]}>
        {status !== "error" ? (
          <WebView
            key={`${captureContext}-${attempt}`}
            originWhitelist={["https://*", "http://*"]}
            source={{ html, baseUrl: config.siteUrl || "https://api-lfa.matrixvert.com" }}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="never"
            onMessage={handleMessage}
            scrollEnabled={fullscreen}
            style={[local.webview, fullscreen ? local.fullscreenWebView : { height: webViewHeight }, { opacity: status === "ready" ? 1 : 0 }]}
          />
        ) : null}

        {status === "loading" ? (
          <View style={[local.loading, { backgroundColor: theme.colors.panel }]}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[local.loadingTitle, { color: theme.colors.ink }]}>{t("payment.form.opening")}</Text>
            <Text style={[local.loadingText, { color: theme.colors.muted }]}>{t("payment.form.wait")}</Text>
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
            <Text style={[local.errorTitle, { color: theme.colors.ink }]}>{t("payment.form.failed")}</Text>
            <Text style={[local.errorText, { color: theme.colors.muted }]}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                completedRef.current = false;
                setError(null);
                setStatus("loading");
                setWebViewHeight(CHECKOUT_LOADING_HEIGHT);
                setAttempt((value) => value + 1);
              }}
              style={({ pressed }) => [local.retryButton, { backgroundColor: theme.colors.primary }, pressed && local.pressed]}
            >
              <Text style={local.retryText}>{t("common.retry")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {!fullscreen ? <Text style={[local.footer, { color: theme.colors.muted }]}>{t("payment.form.secure")}</Text> : null}
    </View>
  );
}

const local = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 520, alignSelf: "center", gap: 14 },
  fullscreenWrap: { flex: 1, maxWidth: undefined, gap: 0 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  headingCopy: { flex: 1, gap: 3 },
  secureMark: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  secureMarkText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  title: { fontSize: 16, lineHeight: 21, fontWeight: "900" },
  subtitle: { fontSize: 12, lineHeight: 17 },
  frame: { width: "100%", overflow: "hidden", borderWidth: 1, borderRadius: 18 },
  fullscreenFrame: { flex: 1, borderWidth: 0, borderRadius: 0 },
  webview: { width: "100%", backgroundColor: "#FFFFFF" },
  fullscreenWebView: { flex: 1 },
  loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: 24, alignItems: "center", justifyContent: "center" },
  loadingTitle: { marginTop: 14, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  loadingText: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  skeletonStack: { width: "100%", marginTop: 28, gap: 12 },
  skeletonWide: { height: 54, borderRadius: 12 },
  skeletonRow: { flexDirection: "row", gap: 10 },
  skeletonHalf: { flex: 1, height: 54, borderRadius: 12 },
  skeletonButton: { height: 48, marginTop: 4, borderRadius: 12 },
  errorState: { minHeight: 240, padding: 28, alignItems: "center", justifyContent: "center" },
  errorTitle: { fontSize: 17, lineHeight: 23, fontWeight: "900", textAlign: "center" },
  errorText: { maxWidth: 360, marginTop: 7, fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryButton: { minHeight: 44, marginTop: 20, paddingHorizontal: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.82 },
  footer: { fontSize: 11, lineHeight: 16, textAlign: "center" },
});
