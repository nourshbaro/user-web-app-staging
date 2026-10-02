type BluePaymentHandoff = {
  id: string;
  paymentUrl: string;
  sessionId: string;
  /** Display-only (success → "View my ticket"); never part of terminal or lock decisions. */
  purchasedMatchId?: string | null;
};

export type PendingBluePaymentAttempt = {
  sessionId: string;
  paymentUrl: string;
  orderId?: string;
  orderNumber?: string;
  reference?: string;
  paymentReference?: string;
  /**
   * Display-only: the one match the BLUE order was submitted for (from the
   * submitted `tickets_by_match`), so a resumed BLUE payment still opens that
   * match's tickets on success. Null for several matches (My Tickets list).
   */
  purchasedMatchId?: string | null;
};

/** A backend match id as submitted, or null; never guessed. */
function matchIdOrNull(value: unknown) {
  return typeof value === "string" && /^\d{1,12}$/.test(value) ? value : null;
}

let sequence = 0;
let activeHandoff: BluePaymentHandoff | null = null;
let pendingAttempt: PendingBluePaymentAttempt | null = null;

export function createBluePaymentHandoff(paymentUrl: string, sessionId: string, purchasedMatchId: string | null = null) {
  sequence += 1;
  const id = `${Date.now()}-${sequence}`;
  activeHandoff = { id, paymentUrl, sessionId, purchasedMatchId: matchIdOrNull(purchasedMatchId) };
  return id;
}

export function readBluePaymentHandoff(id: string) {
  return activeHandoff?.id === id ? activeHandoff : null;
}

export function clearBluePaymentHandoff(id: string) {
  if (activeHandoff?.id === id) activeHandoff = null;
}

export function savePendingBluePaymentAttempt(attempt: PendingBluePaymentAttempt) {
  pendingAttempt = { ...attempt, purchasedMatchId: matchIdOrNull(attempt.purchasedMatchId) };
}

/**
 * Result-route params for a trusted BLUE success: the provider, the
 * display-only values from the terminal URL, and the handoff's own submitted
 * match (if it covered exactly one).
 */
export function blueSuccessResultParams(
  handoff: Pick<BluePaymentHandoff, "purchasedMatchId">,
  displayParams: Record<string, string>,
) {
  const matchId = matchIdOrNull(handoff.purchasedMatchId);
  return { provider: "blue" as const, ...displayParams, ...(matchId ? { match_id: matchId } : {}) };
}

export function readPendingBluePaymentAttempt(sessionId: string) {
  return pendingAttempt?.sessionId === sessionId ? pendingAttempt : null;
}

export function clearPendingBluePaymentAttempt(sessionId?: string) {
  if (sessionId === undefined || pendingAttempt?.sessionId === sessionId) {
    pendingAttempt = null;
  }
}

export function invalidatePendingBluePaymentAttemptUnlessSession(sessionId: string | null) {
  if (pendingAttempt && pendingAttempt.sessionId !== sessionId) pendingAttempt = null;
}
