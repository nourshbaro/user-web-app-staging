/**
 * Where the global "Reservation held · mm:ss · View" indicator appears. Pure
 * module (no React Native imports).
 *
 * The indicator is presentation only. Its value is `CartContext.secondsLeft`,
 * which the cart owner computes from the backend `expires_at`; there is no
 * second timestamp, timer authority or reservation state here.
 */

/**
 * Routes without this indicator: the Cart (its v3 countdown card is the same
 * owner value) and the payment result screens (the reservation is settled
 * there). Everywhere else in the purchase journey — Match Details, ticket
 * holders, Checkout and the Card / BLUE payment screens — this bar is the one
 * countdown (v3); the payment screens no longer draw their own timer.
 */
const OWN_COUNTDOWN_OR_TRANSACTION_ROUTES = [
  /^\/cart$/,
  /^\/checkout\/(success|failed)$/,
  /^\/checkout\/blue\/(success|failed)$/,
];

export function reservationIndicatorAllowedOn(pathname: string) {
  return !OWN_COUNTDOWN_OR_TRANSACTION_ROUTES.some((route) => route.test(pathname));
}

/**
 * Inside the checkout flow (ticket holders, Checkout) the indicator is
 * read-only: it never offers a jump to the Cart while a submission could be
 * in progress.
 */
export function reservationIndicatorInteractive(pathname: string) {
  return !/^\/checkout(\/.*)?$/.test(pathname);
}

export type ReservationIndicatorInput = {
  pathname: string;
  sessionId: string | null;
  itemCount: number;
  /** `CartContext.secondsLeft` (0 when there is no expiry or it has passed). */
  secondsLeft: number;
  /** First-run onboarding is covering the app. */
  onboardingVisible: boolean;
};

/**
 * Visible only while the owner reports an active reservation: a session with
 * items and time left. At zero the owner expires the session itself; this
 * never infers expiry or clears anything.
 */
export function shouldShowReservationIndicator({ pathname, sessionId, itemCount, secondsLeft, onboardingVisible }: ReservationIndicatorInput) {
  if (onboardingVisible) return false;
  if (!sessionId || itemCount <= 0 || secondsLeft <= 0) return false;
  return reservationIndicatorAllowedOn(pathname);
}
