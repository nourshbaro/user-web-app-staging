import { ApiError, ApiTransportError } from "@/services/api";

export function userFacingError(error: unknown, fallback: string) {
  if (error instanceof ApiTransportError) return error.message;
  if (error instanceof ApiError) {
    return backendResponseMessage(error.body) ?? fallback;
  }
  return fallback;
}

export function backendProvidedError(error: unknown, fallback: string) {
  if (error instanceof ApiTransportError) return error.message;
  if (!(error instanceof ApiError)) return fallback;

  return backendResponseMessage(error.body) ??
    (typeof error.message === "string" && error.message.trim()
      ? error.message
      : fallback);
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
  return "Payment could not be completed. Please try again or choose another payment method.";
}
