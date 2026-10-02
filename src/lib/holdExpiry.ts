/**
 * v3 "Reservation expired" (hold_expired) rules. Pure module (unit-tested).
 *
 * \`CartContext\` stays the only expiry authority: it detects expiry from the
 * backend \`expires_at\`, clears the session (same-session guarded) and resets
 * navigation. Just before that destructive clear it captures this snapshot —
 * the only thing that survives: the unique match ids the expired cart held
 * (to offer "Start again") and whether any payment touched the session (to
 * decide whether "No payment was taken" may be said). No seat, lock key,
 * cart session, checkout state or payment data is kept, and nothing here can
 * re-reserve: Start again opens Match Details from a clean state.
 */
export type ExpiredHold = {
  /** Unique backend match ids of the expired cart, in cart order. */
  matchIds: string[];
  /** A payment attempt, pending BLUE request or unknown-outcome lock existed for the session. */
  paymentTouched: boolean;
};

export function expiredHoldFrom(items: readonly { match_id?: unknown }[], paymentTouched: boolean): ExpiredHold {
  const matchIds: string[] = [];
  for (const item of items) {
    const id = typeof item.match_id === "number" ? String(item.match_id) : typeof item.match_id === "string" ? item.match_id.trim() : "";
    if (/^\d{1,12}$/.test(id) && !matchIds.includes(id)) matchIds.push(id);
  }
  return { matchIds, paymentTouched };
}

/**
 * "Start again": the one match's Match Details (a fresh selection there), or
 * Matches on Upcoming when the hold spanned several matches (or none is known).
 * Never picks one of several matches.
 */
export function holdRestartRoute(hold: ExpiredHold) {
  return hold.matchIds.length === 1
    ? { pathname: "/match/[id]" as const, params: { id: hold.matchIds[0] } }
    : ("/matches" as const);
}

/**
 * v3 copy says "No payment was taken". That is only true when no payment
 * ever touched the session; otherwise the sheet says nothing about payment
 * and points to My Tickets (an approval may still be in flight).
 */
export function holdExpiredMessageKey(hold: ExpiredHold) {
  return hold.paymentTouched ? ("holdExpired.messagePayment" as const) : ("holdExpired.message" as const);
}
