import type { CheckoutSubmitRequest } from "@/types";

export type CaptureState =
  | { sessionId: string; status: "loading" }
  | { sessionId: string; status: "ready"; context: string }
  | { sessionId: string; status: "error"; error: string };

export function getActiveCaptureState(state: CaptureState | null, sessionId: string | null) {
  return sessionId !== null && state?.sessionId === sessionId ? state : null;
}

export function createCheckoutBilling(
  name: string,
  email: string,
  canonicalPhone: string | null,
): CheckoutSubmitRequest["billing"] | null {
  if (!canonicalPhone) return null;

  return {
    name,
    email,
    phone: canonicalPhone,
    country: "LB",
  };
}
