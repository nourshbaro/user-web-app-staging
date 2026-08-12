import type { PhoneCountryCode } from "@/lib/phoneNumber";
import type { CheckoutSubmitRequest } from "@/types";

export type CaptureState =
  | { sessionId: string; status: "loading" }
  | { sessionId: string; status: "ready"; context: string }
  | { sessionId: string; status: "error"; error: string };

export type BillingFormState = {
  owner: string | null;
  name: string;
  email: string;
  phoneCountry: PhoneCountryCode;
  phoneNationalValue: string;
  canonicalPhone: string | null;
};

export function getActiveCaptureState(state: CaptureState | null, sessionId: string | null) {
  return sessionId !== null && state?.sessionId === sessionId ? state : null;
}

export function getActiveBillingForm(
  state: BillingFormState | null,
  owner: string | null,
  fallback: BillingFormState,
) {
  return state?.owner === owner ? state : fallback;
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
