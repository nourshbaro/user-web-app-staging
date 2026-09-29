/**
 * Pure presentation rules for the Cart surfaces (Cart screen, cart sheet,
 * Checkout summary). Pure module: no React and no runtime imports.
 *
 * Nothing here owns cart state. `CartContext` (backed by the server) owns the
 * items, totals, session and expiry; these helpers only describe what to show
 * and how to judge a `CartPublication` result for a cart-line action.
 */

/* ------------------------------------------------------------------------ *
 * Screen state
 * ------------------------------------------------------------------------ */

export type CartViewState =
  /** A session exists but its first refresh has not published items yet. */
  | "loading"
  | "active"
  /** Items are still shown but the owner's countdown reached zero; the owner clears them. */
  | "expired"
  | "refreshFailed"
  | "empty";

export function cartViewState({
  sessionId,
  itemCount,
  refreshError,
  secondsLeft,
}: {
  sessionId: string | null;
  itemCount: number;
  refreshError: string | null;
  secondsLeft: number;
}): CartViewState {
  if (itemCount > 0) return secondsLeft <= 0 ? "expired" : "active";
  if (refreshError) return "refreshFailed";
  if (sessionId) return "loading";
  return "empty";
}

/* ------------------------------------------------------------------------ *
 * Reservation countdown (value always comes from CartContext.secondsLeft)
 * ------------------------------------------------------------------------ */

export type ReservationUrgency = "normal" | "low" | "critical" | "expired";

export const RESERVATION_LOW_SECONDS = 120;
export const RESERVATION_CRITICAL_SECONDS = 60;

export function reservationUrgency(secondsLeft: number): ReservationUrgency {
  if (secondsLeft <= 0) return "expired";
  if (secondsLeft <= RESERVATION_CRITICAL_SECONDS) return "critical";
  if (secondsLeft <= RESERVATION_LOW_SECONDS) return "low";
  return "normal";
}

export type ReservationSnapshot = { sessionId: string | null; secondsLeft: number; itemCount: number };

/**
 * True when the owner has just cleared a reservation whose countdown had
 * reached zero while it still held items — the CartContext expiry path. A
 * clear with time remaining (payment success, logout) is never reported as
 * expiry. Observation only: it never clears or changes anything.
 */
export function reservationJustExpired(previous: ReservationSnapshot | null, next: ReservationSnapshot) {
  if (!previous) return false;
  return (
    previous.sessionId !== null &&
    previous.itemCount > 0 &&
    previous.secondsLeft <= 0 &&
    next.sessionId === null
  );
}

/** Whole minutes and seconds for a spoken countdown ("4 minutes 5 seconds"). */
export function countdownParts(secondsLeft: number) {
  const safe = Math.max(0, Math.floor(secondsLeft));
  return { minutes: Math.floor(safe / 60), seconds: safe % 60 };
}

/* ------------------------------------------------------------------------ *
 * Line and total presentation
 * ------------------------------------------------------------------------ */

type DisplayLine = {
  quantity: number;
  subtotal: number;
  currency: string;
  lockKeys: readonly string[];
  seats: readonly unknown[];
};

/** Physical tickets represented by the displayed lines. */
export function ticketCount(lines: readonly Pick<DisplayLine, "quantity">[]) {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
}

/**
 * A GA line backed by exactly one cart line can have its quantity changed.
 * Seat lines are changed by removing them (seats are specific reservations).
 */
export function canAdjustQuantity(line: Pick<DisplayLine, "lockKeys" | "seats">) {
  return line.lockKeys.length === 1 && line.seats.length === 0;
}

/**
 * Display-only sum of line subtotals for one match group. null when any
 * subtotal is not a finite number or currencies differ: never a coerced 0.
 * The authoritative order total is always `cart.total` from the owner.
 */
export function groupSubtotal(lines: readonly Pick<DisplayLine, "subtotal" | "currency">[]) {
  if (!lines.length) return null;
  const currency = lines[0].currency;
  let sum = 0;
  for (const line of lines) {
    if (!Number.isFinite(line.subtotal) || line.currency !== currency) return null;
    sum += line.subtotal;
  }
  return { amount: sum, currency };
}

/** Groups display lines by match, keeping the order matches first appear. */
export function groupLinesByMatch<Line extends { match_id: string; match_title?: string }>(lines: readonly Line[]) {
  const order: string[] = [];
  const byMatch = new Map<string, Line[]>();
  for (const line of lines) {
    if (!byMatch.has(line.match_id)) {
      order.push(line.match_id);
      byMatch.set(line.match_id, []);
    }
    byMatch.get(line.match_id)!.push(line);
  }
  return order.map((matchId) => {
    const matchLines = byMatch.get(matchId)!;
    return { matchId, matchTitle: matchLines[0]?.match_title ?? null, lines: matchLines };
  });
}

/* ------------------------------------------------------------------------ *
 * Judging a cart-line action by what the owner published
 * ------------------------------------------------------------------------ */

type PublishedCart = {
  confirmed: boolean;
  snapshot?: { sessionId: string | null; items: readonly { lock_key: string; quantity?: unknown }[] };
};

/**
 * A quantity change is confirmed only when the owner published a cart for
 * the session the action started in (still current now) that shows the line
 * at exactly the requested quantity.
 */
export function quantityChangeConfirmed(
  publication: PublishedCart,
  { lockKey, quantity, startedInSession, currentSession }: {
    lockKey: string;
    quantity: number;
    startedInSession: string | null;
    currentSession: string | null;
  },
) {
  if (!publication.confirmed || !publication.snapshot) return false;
  const { sessionId, items } = publication.snapshot;
  if (sessionId === null || sessionId !== startedInSession || sessionId !== currentSession) return false;
  const line = items.find((item) => item.lock_key === lockKey);
  return Boolean(line) && Number(line?.quantity) === quantity;
}

/**
 * A removal is confirmed only when the owner published a cart (for the
 * session the action started in, or the cleared empty cart that follows
 * removing the last line) that no longer contains any of the removed lines.
 */
export function removalConfirmed(
  publication: PublishedCart,
  { lockKeys, startedInSession, currentSession }: {
    lockKeys: readonly string[];
    startedInSession: string | null;
    currentSession: string | null;
  },
) {
  if (!publication.confirmed || !publication.snapshot) return false;
  const { sessionId, items } = publication.snapshot;
  if (sessionId !== currentSession) return false;
  const sameSession = sessionId !== null && sessionId === startedInSession;
  const clearedEmpty = sessionId === null && items.length === 0;
  if (!sameSession && !clearedEmpty) return false;
  return !items.some((item) => lockKeys.includes(item.lock_key));
}
