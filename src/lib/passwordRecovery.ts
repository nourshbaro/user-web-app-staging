/**
 * Password recovery: the one owner of the forgot-password flow's state.
 * Pure module (no React, no network) — `src/app/auth.tsx` holds it in a
 * reducer and calls `authService`; every backend answer is applied here.
 *
 * Contract (staging, 2026-10-07; `docs/API_INTEGRATION.md` §Auth):
 * - `POST /auth/forgot-password` takes `{ email }` or `{ phone }`. Every
 *   answer is the same generic 2xx ("If that account is registered…") —
 *   except a phone account without an email, which answers
 *   `{ reason: "email_required" }`. That reason is the only branch signal:
 *   phone + `email_required` → add email; any other 2xx → the code step.
 * - `POST /auth/forgot-password/add-email` `{ email, phone }` saves the email
 *   on that phone's account and sends the code to it.
 * - `verify-otp` and `reset-password` are keyed by the attempt's recovery
 *   identity (`recoveryTarget`): the address the backend sent the code to,
 *   or — phone answered generically — the phone that started the attempt.
 *   Staging still rejects `{ phone, code }` ("The email field is required."),
 *   so the phone → code branch cannot complete until the backend accepts it.
 *
 * Every request belongs to one attempt. Changing the method or the
 * identifier, going Back past the code, cancelling or finishing starts a new
 * attempt, so a late answer for an earlier identifier can never move the
 * current flow. The phone that `add-email` and a phone-keyed code use is the
 * one the backend answered for in this attempt, never the live field.
 */

export type RecoveryMethod = "email" | "phone";

export type RecoveryStep = "identify" | "addEmail" | "code" | "newPassword";

export type RecoveryState = {
  attempt: number;
  step: RecoveryStep;
  method: RecoveryMethod;
  /** Digits-only phone the backend answered for in this attempt (phone path only). */
  phone: string | null;
  /** The address the backend sent this attempt's code to; keys verify / reset when set. */
  email: string | null;
};

/** The identity verify / reset are keyed by for the attempt's code. */
export type RecoveryTarget = { email: string } | { phone: string };

export type RecoveryEvent =
  | { type: "start"; attempt: number; method?: RecoveryMethod }
  | { type: "method"; attempt: number; method: RecoveryMethod }
  /** The identifier on the first step changed: earlier answers are stale. */
  | { type: "identifierEdited"; attempt: number }
  | { type: "codeSent"; attempt: number; email: string }
  /** Phone answered without `email_required`: the code belongs to that phone's attempt. */
  | { type: "phoneCodeSent"; attempt: number; phone: string }
  | { type: "emailRequired"; attempt: number; phone: string }
  | { type: "codeVerified"; attempt: number }
  | { type: "back"; attempt: number }
  | { type: "reset"; attempt: number };

export function initialRecoveryState(attempt = 0, method: RecoveryMethod = "email"): RecoveryState {
  return { attempt, step: "identify", method, phone: null, email: null };
}

/** Monotonic attempt counter, read synchronously after every await. */
export function createRecoveryAttempts() {
  let current = 0;
  return {
    current: () => current,
    next: () => ++current,
    isCurrent: (attempt: number) => attempt === current,
  };
}

/** Events that start a new attempt carry it; answers carry the attempt they were sent in. */
export function recoveryReducer(state: RecoveryState, event: RecoveryEvent): RecoveryState {
  switch (event.type) {
    case "start":
    case "reset":
      return initialRecoveryState(event.attempt, event.type === "start" ? event.method ?? state.method : state.method);
    case "method":
      return initialRecoveryState(event.attempt, event.method);
    // Invalidating events always adopt their attempt, so the state's attempt
    // is the caller's counter and any answer still in flight is stale.
    case "identifierEdited":
      return state.step === "identify"
        ? { ...state, attempt: event.attempt, phone: null, email: null }
        : { ...state, attempt: event.attempt };
    case "back":
      // v3: new password → code (same address); code / add email → the first
      // step, where the code that was sent no longer belongs to the flow.
      if (state.step === "newPassword") return { ...state, attempt: event.attempt, step: "code" };
      if (state.step === "code" || state.step === "addEmail") return initialRecoveryState(event.attempt, state.method);
      return { ...state, attempt: event.attempt };
    default:
      break;
  }

  if (event.attempt !== state.attempt) return state; // stale answer

  switch (event.type) {
    case "codeSent":
      if (state.step === "identify" || state.step === "addEmail") return { ...state, step: "code", email: event.email };
      return state;
    case "phoneCodeSent":
      if (state.step === "identify" && state.method === "phone") return { ...state, step: "code", phone: event.phone, email: null };
      return state;
    case "emailRequired":
      if (state.step === "identify" && state.method === "phone") return { ...state, step: "addEmail", phone: event.phone };
      return state;
    case "codeVerified":
      return state.step === "code" && recoveryTarget(state) ? { ...state, step: "newPassword" } : state;
    default:
      return state;
  }
}

/**
 * Who this attempt's code belongs to: the address the backend sent it to
 * (email path, or after add-email), else the bound phone. Never a live field;
 * none before a code exists (identify, add email).
 */
export function recoveryTarget(state: RecoveryState): RecoveryTarget | null {
  if (state.step !== "code" && state.step !== "newPassword") return null;
  if (state.email) return { email: state.email };
  if (state.method === "phone" && state.phone) return { phone: state.phone };
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a 2xx `forgot-password` answer. `email_required` is the backend's
 * only branch signal; anything else means "a code was sent if the account
 * exists" (the backend deliberately does not say whether it does).
 */
export function forgotPasswordOutcome(payload: unknown): "codeSent" | "emailRequired" {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (isRecord(data) && data.reason === "email_required") return "emailRequired";
  if (isRecord(payload) && payload.reason === "email_required") return "emailRequired";
  return "codeSent";
}

export const isValidRecoveryEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
