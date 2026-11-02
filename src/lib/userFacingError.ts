import { translate } from "../i18n/runtime.ts";
import { ApiError, ApiTransportError } from "@/services/api";

/**
 * Why a request failed, as the backend (or the transport) put it: the
 * backend's `message` / `error` / first validation error, or the fixed
 * offline/timeout text. Null when neither gave a reason.
 */
export function failureReason(error: unknown): string | null {
  if (error instanceof ApiTransportError) return error.message;
  if (error instanceof ApiError) return backendResponseMessage(error.body);
  return null;
}

export function userFacingError(error: unknown, fallback: string) {
  return failureReason(error) ?? fallback;
}

/**
 * The failure reason followed by guidance the user must still act on — e.g. a
 * payment whose outcome is unknown and may have gone through.
 */
export function reasonWithGuidance(error: unknown, guidance: string) {
  const reason = failureReason(error);
  return reason ? `${reason} ${guidance}` : guidance;
}

export function backendProvidedError(error: unknown, fallback: string) {
  if (error instanceof ApiTransportError) return error.message;
  if (!(error instanceof ApiError)) return fallback;

  // `ApiError.message` adds nothing beyond the body except the transport
  // text ("Request failed with 500"), which is never shown to users.
  return backendResponseMessage(error.body) ?? fallback;
}

export function backendResponseMessage(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const structured = body as Record<string, unknown>;

  for (const value of [structured.message, structured.error]) {
    if (typeof value === "string" && value.trim()) return value;
  }

  const validationErrors = structured.errors;
  if (validationErrors && typeof validationErrors === "object") {
    for (const value of Object.values(validationErrors)) {
      if (typeof value === "string" && value.trim()) return value;
      if (Array.isArray(value)) {
        const first = value.find(
          (item): item is string =>
            typeof item === "string" && Boolean(item.trim()),
        );
        if (first) return first;
      }
    }
  }

  return null;
}

export function paymentError() {
  return translate("payment.generic");
}
