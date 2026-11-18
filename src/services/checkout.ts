import type { AuthenticationSnapshot } from "@/lib/authSessionOwnership";
import { apiRequest } from "@/services/api";
import type { CheckoutSubmitRequest, CheckoutSubmitResponse } from "@/types";

export const checkoutService = {
  /**
   * `authentication`: pin the request to the authentication that opened the
   * payment (the card screen's captured snapshot). Its token is sent, a
   * 401/403 can end only that authentication, and nothing is sent once it is
   * no longer current. Omitted: the live session.
   */
  async submit(payload: CheckoutSubmitRequest, options: { authentication?: AuthenticationSnapshot } = {}) {
    return apiRequest<CheckoutSubmitResponse>("/checkout/mobile/submit", {
      method: "POST",
      body: JSON.stringify(payload),
      ...(options.authentication ? { authenticationSnapshot: options.authentication } : {}),
    });
  },

  async captureContext(checkoutSessionId: string, targetOrigins: string[]) {
    return apiRequest<any>("/payments/cybersource/capture-context", {
      method: "POST",
      body: JSON.stringify({ checkout_session_id: checkoutSessionId, target_origins: targetOrigins, locale: "en-us" }),
    });
  },
};
