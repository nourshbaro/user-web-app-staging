import { ApiTransportError } from "@/services/api";

export function userFacingError(error: unknown, fallback: string) {
  if (error instanceof ApiTransportError) return error.message;
  return fallback;
}

export function paymentError() {
  return "Payment could not be completed. Please try again or choose another payment method.";
}
