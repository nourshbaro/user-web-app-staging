import { translate } from "../i18n/runtime.ts";
export type CybersourceCheckout = {
  mount(selector?: string | { paymentSelection?: string; paymentScreen?: string }): Promise<string>;
  on?(event: "ready", handler: () => void): unknown;
  destroy(): void;
};

export type CybersourceClient = {
  createCheckout(options?: { autoProcessing?: boolean }): Promise<CybersourceCheckout>;
  destroy(): void;
};

type ScriptTarget = {
  addEventListener(type: "load" | "error", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "load" | "error", listener: () => void): void;
};

type LifecycleOptions = {
  captureContext: string;
  unifiedCheckout: (captureContext: string) => Promise<CybersourceClient>;
  onReady: () => void;
  onSuccess: (token: string) => void;
  /** `afterShown`: the failure came after the form was mounted for the payer (a payment may have been in progress). */
  onError: (message: string, details?: { afterShown: boolean }) => void;
};

// Kept as the English compatibility export; live UI messages resolve at event time.
export const CYBERSOURCE_SCRIPT_ERROR = "Could not load the payment SDK. Check your connection and try again.";

export function createCybersourceWebLifecycle(options: LifecycleOptions) {
  const identity = Symbol("cybersource-web-lifecycle");
  let active = true;
  let started = false;
  let client: CybersourceClient | null = null;
  let checkout: CybersourceCheckout | null = null;
  let clientDestroyed = false;
  let checkoutDestroyed = false;
  let removeScriptListeners: (() => void) | null = null;
  // mount() was called: the form is (or was) on screen for the payer.
  let mounted = false;

  const destroyClient = (ownedClient: CybersourceClient | null) => {
    if (!ownedClient || clientDestroyed) return;
    clientDestroyed = true;
    ownedClient.destroy();
  };

  const destroyCheckout = (ownedCheckout: CybersourceCheckout | null) => {
    if (!ownedCheckout || checkoutDestroyed) return;
    checkoutDestroyed = true;
    ownedCheckout.destroy();
  };

  const destroyOwnedResources = () => {
    destroyCheckout(checkout);
    destroyClient(client);
  };

  // The provider's own reason when it gave one, else catalog copy.
  const reportError = (err: unknown) => {
    if (!active) return;
    const record = err && typeof err === "object" ? (err as { message?: unknown; reason?: unknown }) : null;
    const reason = record ? (typeof record.message === "string" && record.message.trim() ? record.message : record.reason) : null;
    options.onError(typeof reason === "string" && reason.trim() ? reason : translate("payment.form.generic"), { afterShown: mounted });
  };

  const start = async () => {
    if (!active || started) return;
    started = true;

    try {
      const createdClient = await options.unifiedCheckout(options.captureContext);
      if (!active) {
        createdClient.destroy();
        return;
      }
      client = createdClient;

      const createdCheckout = await createdClient.createCheckout({ autoProcessing: true });
      if (!active) {
        createdCheckout.destroy();
        return;
      }
      checkout = createdCheckout;
      createdCheckout.on?.("ready", () => {
        if (active) options.onReady();
      });

      mounted = true;
      const transientToken = await createdCheckout.mount({
        paymentSelection: "#uc-payment-buttons",
        paymentScreen: "#uc-payment-form",
      });
      if (!active) return;
      options.onSuccess(transientToken);
    } catch (err) {
      reportError(err);
    } finally {
      destroyOwnedResources();
    }
  };

  const listenForScript = (script: ScriptTarget) => {
    if (!active) return;
    const onLoad = () => {
      removeScriptListeners?.();
      removeScriptListeners = null;
      void start();
    };
    const onError = () => {
      removeScriptListeners?.();
      removeScriptListeners = null;
      if (active) options.onError(translate("payment.form.sdkFailed"), { afterShown: false });
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    removeScriptListeners = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
  };

  const invalidate = () => {
    if (!active) return;
    active = false;
    removeScriptListeners?.();
    removeScriptListeners = null;
    destroyOwnedResources();
  };

  return { identity, start, listenForScript, invalidate };
}
