/**
 * What happens after Login or Register, decided by the backend response only.
 * Pure module.
 *
 * Product rule: Login and Register have no OTP step of their own. The app
 * never asks for a code the backend did not require — the former client-side
 * email-verification pre-check before Login is gone. A code is asked for only
 * when the backend withholds the session: it names the account (`user_id` /
 * `user.id`) but returns no token. Forgot-password keeps its own OTP steps.
 *
 * - `session`: the response carries a token (the service already saved it).
 * - `verify`:  an account id without a token — the backend requires the code.
 * - `signIn`:  neither (e.g. a register response without a session): the
 *              account exists, so the user signs in normally.
 */
export type CredentialOutcome = "session" | "verify" | "signIn";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export function credentialUserId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.user_id === "number" || typeof payload.user_id === "string") return String(payload.user_id);
  if (isRecord(payload.user) && (typeof payload.user.id === "number" || typeof payload.user.id === "string")) {
    return String(payload.user.id);
  }
  if (isRecord(payload.data)) return credentialUserId(payload.data);
  return null;
}

export function hasSessionToken(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (readString(payload.token) || readString(payload.access_token)) return true;
  return hasSessionToken(payload.data);
}

export function credentialOutcome(payload: unknown): CredentialOutcome {
  if (hasSessionToken(payload)) return "session";
  return credentialUserId(payload) ? "verify" : "signIn";
}
