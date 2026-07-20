import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { colors, styles } from "@/components/ui";
import { config } from "@/lib/config";

type Props = {
  captureContext: string;
  onSuccess: (token: string) => void;
  onError: (message: string) => void;
};

type CheckoutMessage =
  | { type: "ready" }
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
        background: transparent;
        color: #151a2c;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #status {
        color: #6b7280;
        font-size: 14px;
        line-height: 20px;
        padding: 2px 0 12px;
      }
      #uc-payment-buttons {
        min-height: 260px;
      }
    </style>
  </head>
  <body>
    <div id="status">Loading secure payment form...</div>
    <div id="uc-payment-buttons"></div>
    <script>
      const post = (payload) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      const fail = (error) => {
        const message = error && (error.reason || error.message) ? (error.reason || error.message) : "Payment could not be completed. Please try again.";
        document.getElementById("status").textContent = message;
        post({ type: "error", message });
      };

      window.addEventListener("error", (event) => fail(event.error || new Error(event.message)));

      async function initCheckout() {
        try {
          if (!window.VAS) throw new Error("Cybersource SDK is not ready.");

          const client = await window.VAS.UnifiedCheckout(${safeCaptureContext});
          const checkout = await client.createCheckout({ autoProcessing: false });
          document.getElementById("status").textContent = "";
          post({ type: "ready" });

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
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const completedRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const html = useMemo(() => buildCheckoutHtml(captureContext), [captureContext]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    completedRef.current = false;
    setStatus("loading");
    setError(null);
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
      {status === "loading" ? <Text style={styles.muted}>Loading secure payment form...</Text> : null}
      {status === "ready" ? <Text style={styles.muted}>Enter your card details securely below.</Text> : null}
      {status === "error" && error ? <Text style={local.errorText}>{error}</Text> : null}
      <WebView
        originWhitelist={["https://*", "http://*"]}
        source={{ html, baseUrl: config.siteUrl || "https://api-lfa.matrixvert.com" }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="never"
        onMessage={handleMessage}
        style={local.webview}
      />
    </View>
  );
}

const local = {
  wrap: { gap: 8 },
  webview: { height: 340, backgroundColor: "transparent" },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
};
