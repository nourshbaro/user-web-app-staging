import type { CheckoutSubmitRequest } from "@/types";
import type { AuthenticationSnapshot } from "@/lib/authSessionOwnership";
import type { CartSessionTicket } from "@/lib/cartSessionAuthority";
import type { CardResultClaim, PaymentAttempt } from "@/lib/paymentOutcomeLock";

export type CardPaymentRetry = {
  cardResult: string;
  snapshot: AuthenticationSnapshot;
  cartTicket: CartSessionTicket;
  claim: CardResultClaim;
  attempt: PaymentAttempt;
  reference: string | null;
  reason: string | null;
  /** Whether the marker was saved on this device; null while unknown. */
  saved: boolean | null;
};

type CardPaymentHandoff = {
  id: string;
  sessionId: string;
  /** The signed-in account that prepared this payment; an unresolved card result is bound to it. */
  accountId: string | null;
  captureContext: string | null;
  prepareCaptureContext: (force?: boolean) => Promise<string>;
  request: Omit<CheckoutSubmitRequest, "payment">;
  /** Process-local only. The durable recovery marker does not include this data. */
  retry?: CardPaymentRetry;
};

let sequence = 0;
let activeHandoff: CardPaymentHandoff | null = null;

export function createCardPaymentHandoff(input: Omit<CardPaymentHandoff, "id" | "retry">) {
  sequence += 1;
  const id = `${Date.now()}-${sequence}`;
  activeHandoff = { id, ...input };
  return id;
}

export function readCardPaymentHandoff(id: string) {
  return activeHandoff?.id === id ? activeHandoff : null;
}

export function clearCardPaymentHandoff(id: string) {
  if (activeHandoff?.id === id) activeHandoff = null;
}

export function saveCardPaymentRetry(id: string, retry: CardPaymentRetry) {
  if (activeHandoff?.id === id) activeHandoff.retry = retry;
}

export function takeCardPaymentRetry(id: string) {
  const handoff = readCardPaymentHandoff(id);
  const retry = handoff?.retry;
  if (handoff) delete handoff.retry;
  return retry;
}

/**
 * Whether a card result that was never sent is held for this cart session.
 * The cart owner defers its client-side expiry while one is held, so the
 * reservation timer alone never discards it: the backend decides whether the
 * reservation is still valid when it is sent. The hold ends when the result
 * is taken for sending, or is dropped because its session or authentication
 * ended (`discardStaleCardPaymentRetry`).
 */
export function hasHeldCardResult(sessionId: string | null) {
  return sessionId !== null && activeHandoff?.sessionId === sessionId && activeHandoff.retry !== undefined;
}

export function findCardPaymentRetry(
  sessionId: string | null,
  accountId: string | null,
  isCurrent: (snapshot: AuthenticationSnapshot, cartTicket: CartSessionTicket, attempt: PaymentAttempt) => boolean,
  resultKey?: string,
) {
  const retry = activeHandoff?.retry;
  return retry && activeHandoff?.sessionId === sessionId && activeHandoff.accountId === accountId
    && (resultKey === undefined || retry.claim.key === resultKey)
    && isCurrent(retry.snapshot, retry.cartTicket, retry.attempt)
    ? activeHandoff.id
    : null;
}

export function discardStaleCardPaymentRetry(
  isCurrent: (snapshot: AuthenticationSnapshot, cartTicket: CartSessionTicket) => boolean,
) {
  const retry = activeHandoff?.retry;
  if (retry && !isCurrent(retry.snapshot, retry.cartTicket)) activeHandoff = null;
}
