export type CaptureState =
  | { sessionId: string; status: "loading" }
  | { sessionId: string; status: "ready"; context: string }
  | { sessionId: string; status: "error"; error: string };

export type BillingFormState = {
  owner: string | null;
  name: string;
  email: string;
  phone: string;
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
