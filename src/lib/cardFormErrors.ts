/**
 * What the card screen does when the CyberSource form reports an error.
 * Pure module: no React and no runtime imports.
 */
export type CardFormErrorDetails = {
  /** The form had been shown to the payer: a payment may have been in progress in it. */
  afterShown: boolean;
  /** The WebView's content process died: no result can arrive from it any more. */
  terminated: boolean;
};

/**
 * - "retryInForm": the form never became usable (the SDK failed to load, or
 *   it timed out while opening). Nothing could have been paid in it, so its
 *   own Retry may reload it.
 * - "outcomeUnknown": the form ended without a result after the payer could
 *   use it (the provider rejected `mount()`, or the WebView died). The
 *   client cannot tell a decline from a payment taken before the failure, so
 *   this is never shown as a cancellation and the form is not reloaded in
 *   place: the payer is told to check My Tickets before paying again. Only
 *   backend reconciliation with CyberSource can settle such a payment.
 */
export function cardFormErrorAction(details: CardFormErrorDetails): "retryInForm" | "outcomeUnknown" {
  return details.afterShown || details.terminated ? "outcomeUnknown" : "retryInForm";
}
