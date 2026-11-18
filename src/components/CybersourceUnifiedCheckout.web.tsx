import { translate } from "@/i18n/runtime";
import { useI18n } from "@/i18n/I18nProvider";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/components/ui";
import { config } from "@/lib/config";
import type { CardFormErrorDetails } from "@/lib/cardFormErrors";
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
  onError: (message: string, details: CardFormErrorDetails) => void;
  fullscreen?: boolean;
  /** Blocks new input without unmounting the form (see the native bridge). */
  locked?: boolean;
};

export function CybersourceUnifiedCheckout({ captureContext, onSuccess, onError, fullscreen = false, locked = false }: Props) {
  const theme = useTheme();
  const { t } = useI18n();
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
    // Locked: move focus out of the card fields (an iframe keeps keyboard input otherwise).
    if (!locked || typeof document === "undefined") return;
    const focused = document.activeElement as HTMLElement | null;
    focused?.blur?.();
  }, [locked]);

  useEffect(() => {
    if (!captureContext) return;

    const lifecycle = createCybersourceWebLifecycle({
      captureContext,
      unifiedCheckout: async (context) => {
        if (!window.VAS) throw new Error(translate("payment.form.notReady"));
        return window.VAS.UnifiedCheckout(context);
      },
      onReady: () => {
        if (currentLifecycleRef.current === lifecycle.identity) setStatus("ready");
      },
      onSuccess: (token) => {
        if (currentLifecycleRef.current === lifecycle.identity) onSuccessRef.current(token);
      },
      onError: (message, details) => {
        if (currentLifecycleRef.current !== lifecycle.identity) return;
        setStatus("error");
        setError(message);
        onErrorRef.current(message, { afterShown: details?.afterShown ?? false, terminated: false });
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
    <View style={[local.wrap, fullscreen && local.fullscreen]} aria-hidden={locked}>
      {status === "loading" ? <Text style={theme.styles.muted}>{t("payment.form.loading")}</Text> : null}
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
