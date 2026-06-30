import { apiRequest } from "@/services/api";
import type { CheckoutSubmitRequest } from "@/types";

export const checkoutService = {
  async submit(payload: CheckoutSubmitRequest) {
    return apiRequest<any>("/checkout/web/submit", { method: "POST", body: JSON.stringify(payload) });
  },

  async captureContext(checkoutSessionId: string, targetOrigins: string[]) {
    return apiRequest<any>("/payments/cybersource/capture-context", {
      method: "POST",
      body: JSON.stringify({ checkout_session_id: checkoutSessionId, target_origins: targetOrigins, locale: "en-us" }),
    });
  },
};
