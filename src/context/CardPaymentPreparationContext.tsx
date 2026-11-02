import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { useCart } from "@/context/CartContext";
import type { CaptureState } from "@/lib/checkoutOwnership";
import {
  beginCaptureContextRequest,
  invalidateCaptureContextRequestRefs,
  releaseCaptureContextRetry,
} from "@/lib/captureContextRequestGuard";
import { config } from "@/lib/config";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { userFacingError } from "@/lib/userFacingError";
import { checkoutService } from "@/services/checkout";

function getCheckoutOrigin() {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return config.apiOrigin;
}

function readCaptureContext(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { capture_context?: unknown; data?: { capture_context?: unknown } };
  const value = record.data?.capture_context ?? record.capture_context;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Single owner of CyberSource capture-context preparation for the checkout
 * flow.
 *
 * This state and its request authority previously lived only as local
 * `useState`/refs inside the Checkout screen, so Checkout had to block
 * "Continue" (with a "please wait" message) until preparation finished
 * before it could hand a ready capture context to the dedicated Card
 * Payment route. Hoisting the *same* state/authority here (not a second
 * one) lets Checkout selection still kick preparation off exactly as
 * before, while the Card Payment screen observes its live loading/ready/
 * error status and Checkout can navigate to it immediately.
 */
type CardPaymentPreparationContextValue = {
  captureState: CaptureState | null;
  loadCaptureContext: (sessionId: string, force?: boolean) => Promise<void>;
};

const CardPaymentPreparationContext = createContext<CardPaymentPreparationContextValue | null>(null);

export function CardPaymentPreparationProvider({ children }: PropsWithChildren) {
  const cart = useCart();
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const captureSessionRef = useRef<string | null>(null);
  const captureRetrySessionRef = useRef<string | null>(null);
  const captureRequestAuthority = useMemo(() => createRequestAuthority(), []);

  useEffect(() => {
    captureRequestAuthority.mount();
    return () => captureRequestAuthority.unmount();
  }, [captureRequestAuthority]);

  useEffect(() => {
    captureRequestAuthority.invalidate(cart.sessionId);
    invalidateCaptureContextRequestRefs(
      captureSessionRef,
      captureRetrySessionRef,
      cart.sessionId,
    );
  }, [captureRequestAuthority, cart.sessionId]);

  const loadCaptureContext = useCallback(async (sessionId: string, force = false) => {
    const started = beginCaptureContextRequest(
      captureSessionRef,
      captureRetrySessionRef,
      sessionId,
      force,
    );
    if (!started) return;

    const ticket = captureRequestAuthority.begin(sessionId);

    setCaptureState({ sessionId, status: "loading" });
    try {
      const response = await checkoutService.captureContext(sessionId, [getCheckoutOrigin()]);
      const context = readCaptureContext(response);
      if (!context) throw new Error("Payment form could not be prepared.");
      if (!captureRequestAuthority.isCurrent(ticket)) return;
      setCaptureState({ sessionId, status: "ready", context });
    } catch (err) {
      if (!captureRequestAuthority.isCurrent(ticket)) return;
      captureSessionRef.current = null;
      setCaptureState({
        sessionId,
        status: "error",
        error: userFacingError(err, "Could not prepare card payment. Please try again."),
      });
    } finally {
      releaseCaptureContextRetry(captureRetrySessionRef, sessionId, force);
    }
  }, [captureRequestAuthority]);

  const value = useMemo<CardPaymentPreparationContextValue>(
    () => ({ captureState, loadCaptureContext }),
    [captureState, loadCaptureContext],
  );

  return (
    <CardPaymentPreparationContext.Provider value={value}>
      {children}
    </CardPaymentPreparationContext.Provider>
  );
}

export function useCardPaymentPreparation() {
  const context = useContext(CardPaymentPreparationContext);
  if (!context) throw new Error("useCardPaymentPreparation must be used inside CardPaymentPreparationProvider");
  return context;
}
