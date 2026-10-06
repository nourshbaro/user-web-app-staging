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
  onError: (message: string) => void;
};

const DEFAULT_ERROR = "Payment could not be completed. Please try again.";
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

  const reportError = (_err: unknown) => {
    if (!active) return;
    options.onError(DEFAULT_ERROR);
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
      if (active) options.onError(CYBERSOURCE_SCRIPT_ERROR);
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
