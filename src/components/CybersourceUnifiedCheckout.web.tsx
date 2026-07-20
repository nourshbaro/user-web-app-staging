import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { colors, styles } from "@/components/ui";
import { config } from "@/lib/config";

declare global {
  interface Window {
    VAS?: {
      UnifiedCheckout: (sessionJWT: string) => Promise<UCClient>;
    };
  }
}

type UCCheckout = {
  mount(selector?: string | { paymentSelection?: string; paymentScreen?: string }): Promise<string>;
  unmount(): void;
  destroy(): void;
  complete(transientToken: string): Promise<unknown>;
};

type UCClient = {
  createCheckout(options?: { autoProcessing?: boolean }): Promise<UCCheckout>;
  destroy(): void;
};

type Props = {
  captureContext: string;
  onSuccess: (token: string) => void;
  onError: (message: string) => void;
};

export function CybersourceUnifiedCheckout({ captureContext, onSuccess, onError }: Props) {
  const clientRef = useRef<UCClient | null>(null);
  const checkoutRef = useRef<UCCheckout | null>(null);
  const mountingRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    if (Platform.OS !== "web") {
      setStatus("error");
      setError("Card checkout is available on web only.");
      onErrorRef.current("Card checkout is available on web only.");
      return;
    }

    if (!captureContext || mountingRef.current) return;
    mountingRef.current = true;

    const init = async () => {
      try {
        if (!window.VAS) throw new Error("Cybersource SDK is not ready.");

        const client = await window.VAS.UnifiedCheckout(captureContext);
        clientRef.current = client;

        const checkout = await client.createCheckout({ autoProcessing: false });
        checkoutRef.current = checkout;
        setStatus("ready");

        const transientToken = await checkout.mount("#uc-payment-buttons");
        onSuccessRef.current(transientToken);
      } catch (err) {
        const candidate = err as { message?: string; reason?: string };
        const message = candidate?.reason ?? candidate?.message ?? "Payment could not be completed. Please try again.";
        setStatus("error");
        setError(message);
        onErrorRef.current(message);
      } finally {
        checkoutRef.current?.destroy();
        clientRef.current?.destroy();
        checkoutRef.current = null;
        clientRef.current = null;
        mountingRef.current = false;
      }
    };

    const scriptId = "cybersource-uc-sdk";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (existing) {
      if (window.VAS) void init();
      else existing.addEventListener("load", () => void init(), { once: true });
      return () => {
        checkoutRef.current?.destroy();
        clientRef.current?.destroy();
      };
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = config.cybersourceUnifiedCheckoutUrl;
    script.async = true;
    script.onload = () => void init();
    script.onerror = () => {
      const message = "Could not load the payment SDK. Check your connection and try again.";
      setStatus("error");
      setError(message);
      onErrorRef.current(message);
    };
    document.head.appendChild(script);

    return () => {
      checkoutRef.current?.destroy();
      clientRef.current?.destroy();
    };
  }, [captureContext]);

  return (
    <View style={local.wrap}>
      {status === "loading" ? <Text style={styles.muted}>Loading secure payment form...</Text> : null}
      {status === "error" && error ? <Text style={local.errorText}>{error}</Text> : null}
      <View nativeID="uc-payment-buttons" style={local.buttons} />
    </View>
  );
}

const local = {
  wrap: { gap: 8 },
  buttons: { minHeight: 44 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
};
