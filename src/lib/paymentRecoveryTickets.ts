/**
 * Recovery from an unknown payment outcome (or a payment lock) sends the user
 * to My Tickets to check whether the order went through. That visit must show
 * what the backend says now, not a portal list cached before the payment, so
 * those recovery actions — and only they — open My Tickets with this signal.
 *
 * The signal only refreshes the portal reads. It never resolves, clears or
 * reinterprets the unknown outcome or the payment lock, and a missing ticket
 * is never treated as a failed payment.
 */
export const PAYMENT_RECOVERY_TICKETS_ROUTE = {
  pathname: "/tickets",
  params: { refresh: "payment" },
} as const;

export function isPaymentRecoveryVisit(refresh: string | string[] | undefined) {
  return (Array.isArray(refresh) ? refresh[0] : refresh) === PAYMENT_RECOVERY_TICKETS_ROUTE.params.refresh;
}
