type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A usable order identifier: a positive integer, or a short token. */
function orderIdentifier(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : null;
}

const status = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : null);

/**
 * Order status that marks a paid order. Evidence: the order status set used
 * by the order endpoints and admin-dash (`pending_payment | paid | failed |
 * cancelled | expired`), the staging card payment of 2026-11-02 (order 1105,
 * status `paid`), and the same narrowing in pos-web. Not a confirmed field of
 * the `/checkout/mobile/submit` response.
 */
const PAID_ORDER_STATUS = "paid";

/**
 * `payment.status` values that do not contradict a paid order. Any other
 * value (declined, pending, review, failed, voided, unknown words) leaves the
 * response unresolved.
 */
const COMPLETE_PAYMENT_STATUSES = new Set(["paid", "authorized", "captured", "completed", "succeeded", "success", "settled", "approved"]);

/**
 * Whether a 2xx `/checkout/mobile/submit` response proves a completed card
 * order. The backend's success contract is NOT confirmed (no backend source
 * in this workspace; `user-web` accepts any 2xx, which is not evidence of the
 * contract), so this is a conservative frontend narrowing, not a contract.
 * "unresolved" means "not proven", never "failed": the card may have been
 * charged, so the cart and the marker are kept and paying again stays
 * blocked.
 *
 * Complete only when all of these hold:
 * - the body is a JSON object (an empty or unparseable body arrives as null
 *   from `apiRequest`; JSON `null`, arrays and bare values are not objects);
 * - `success`, if present, is exactly `true` (`false` or a non-boolean is
 *   not proof);
 * - `payment`, if present, is an object without a truthy `payment_url`
 *   (a redirect means the provider still needs the payer);
 * - an order is named: a valid `order_id` or `order_number`;
 * - the order `status` is `paid`;
 * - `payment.status`, if present, is one of `COMPLETE_PAYMENT_STATUSES`.
 *
 * Only called for a 2xx: `apiRequest` throws for every other status, and
 * those stay unresolved. This app's web proxy passes bodies through
 * unchanged (`src/app/api/[...path]+api.ts`), so web and native read the same
 * body. This single decision drives the success screen, clearing the matching
 * cart and releasing the unresolved-result marker.
 */
export function cardSubmitCompletion(response: unknown): "complete" | "unresolved" {
  if (!isRecord(response)) return "unresolved";
  if (response.success !== undefined && response.success !== true) return "unresolved";
  const payment = response.payment;
  if (payment !== undefined && payment !== null && !isRecord(payment)) return "unresolved";
  if (isRecord(payment) && payment.payment_url) return "unresolved";
  if (!orderIdentifier(response.order_id) && !orderIdentifier(response.order_number)) return "unresolved";
  if (status(response.status) !== PAID_ORDER_STATUS) return "unresolved";
  if (isRecord(payment) && payment.status !== undefined && payment.status !== null) {
    const paymentStatus = status(payment.status);
    if (paymentStatus === null || !COMPLETE_PAYMENT_STATUSES.has(paymentStatus)) return "unresolved";
  }
  return "complete";
}

/**
 * The order a submit response named, for display to the customer and
 * support on an unresolved outcome. Unverified; decides nothing.
 */
export function cardSubmitOrderReference(response: unknown): string | null {
  if (!isRecord(response)) return null;
  return orderIdentifier(response.order_number) ?? orderIdentifier(response.order_id);
}

/**
 * Reads a support reference from the value CyberSource Unified Checkout's
 * `mount()` resolves with. With autoProcessing that value is the completed
 * payment-result JWT (claims include `id`, `status`, `outcome`, `details`);
 * without it, a transient-token JWT.
 *
 * Nothing here is verified: the signature is not checked, and no claim
 * (status included) decides whether money moved, whether to submit, or what
 * the user is told about the charge. Only the backend verifies the result.
 * The `id` is shown solely as a reference the customer can give support.
 */
export function cardResultReference(result: string): string | null {
  const payload = result.split(".")[1];
  if (!payload || payload.length > 65536) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims = JSON.parse(json) as { id?: unknown } | null;
    const id = claims && typeof claims === "object" ? claims.id : null;
    return typeof id === "string" && /^[A-Za-z0-9-]{6,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Whether a 2xx `/checkout/mobile/submit` response for `payment_method:
 * "free"` proves the order was created. Same rule as a completed card order
 * (`cardSubmitCompletion`): an order id or number, status `paid`, no
 * `payment_url`. The free response shape (order id + status `paid`) was
 * stated by the product owner (2026-11-18); it is not verified against
 * backend source. "unresolved" means "not proven": the order may exist, so
 * the cart is kept and the session is locked against a second submission.
 */
export function freeSubmitCompletion(response: unknown): "complete" | "unresolved" {
  return cardSubmitCompletion(response);
}
