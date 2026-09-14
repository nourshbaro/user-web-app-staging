import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/components/ui";
import { config } from "@/lib/config";
import {
  createCybersourceWebLifecycle,
  type CybersourceClient,
} from "@/lib/cybersourceWebLifecycle";

declare global {
  interface Window {
    VAS?: {
      UnifiedCheckout: (sessionJWT: string) => Promise<CybersourceClient>;
    };
  }
}

type Props = {
  captureContext: string;
  onSuccess: (token: string) => void;
  onError: (message: string) => void;
  fullscreen?: boolean;
};

export function CybersourceUnifiedCheckout({ captureContext, onSuccess, onError, fullscreen = false }: Props) {
  const theme = useTheme();
  const currentLifecycleRef = useRef<symbol | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    if (!captureContext) return;

    const lifecycle = createCybersourceWebLifecycle({
      captureContext,
      unifiedCheckout: async (context) => {
        if (!window.VAS) throw new Error("Payment form is not ready.");
        return window.VAS.UnifiedCheckout(context);
      },
      onReady: () => {
        if (currentLifecycleRef.current === lifecycle.identity) setStatus("ready");
      },
      onSuccess: (token) => {
        if (currentLifecycleRef.current === lifecycle.identity) onSuccessRef.current(token);
      },
      onError: (message) => {
        if (currentLifecycleRef.current !== lifecycle.identity) return;
        setStatus("error");
        setError(message);
        onErrorRef.current(message);
      },
    });
    currentLifecycleRef.current = lifecycle.identity;

    const scriptId = "cybersource-uc-sdk";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (existing) {
      if (window.VAS) void lifecycle.start();
      else lifecycle.listenForScript(existing);
    } else {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = config.cybersourceUnifiedCheckoutUrl;
      script.async = true;
      lifecycle.listenForScript(script);
      document.head.appendChild(script);
    }

    return () => {
      lifecycle.invalidate();
      if (currentLifecycleRef.current === lifecycle.identity) currentLifecycleRef.current = null;
    };
  }, [captureContext]);

  return (
    <View style={[local.wrap, fullscreen && local.fullscreen]}>
      {status === "loading" ? <Text style={theme.styles.muted}>Loading secure payment form...</Text> : null}
      {status === "error" && error ? <Text style={[local.errorText, { color: theme.colors.danger }]}>{error}</Text> : null}
      <View nativeID="uc-payment-buttons" style={local.buttons} />
      <View nativeID="uc-payment-form" style={local.form} />
    </View>
  );
}

const local = {
  wrap: { gap: 8 },
  fullscreen: { flex: 1 },
  buttons: { minHeight: 44 },
  form: { width: "100%" as const },
  errorText: { fontSize: 13, lineHeight: 18 },
};
