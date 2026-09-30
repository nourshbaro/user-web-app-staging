/**
 * Pure rules for the ticket-holder step and Checkout. Pure module: no React
 * and no runtime imports.
 *
 * Holder names are owned by `TicketHoldersContext`; submission, capture
 * context and payment handoff are owned by `src/app/checkout.tsx` and the
 * payment screens. These helpers only derive views, readiness and the
 * existing request payload shape from those owners' values.
 */

type Slot = {
  key: string;
  matchId: string;
  matchTitle?: string;
  zoneName: string;
  label: string;
};

/* ------------------------------------------------------------------------ *
 * Ticket holders
 * ------------------------------------------------------------------------ */

/** The one existing validation rule: a holder name is required (non-blank). */
export function isHolderNameValid(value: string | undefined | null) {
  return Boolean(value?.trim());
}

export function holderCompleteness(slots: readonly Slot[], names: Readonly<Record<string, string>>) {
  const missingKeys = slots.filter((slot) => !isHolderNameValid(names[slot.key])).map((slot) => slot.key);
  return {
    total: slots.length,
    complete: slots.length - missingKeys.length,
    missingKeys,
    /** The field to focus first when the user tries to continue. */
    firstIncompleteKey: missingKeys[0] ?? null,
    allComplete: slots.length > 0 && missingKeys.length === 0,
  };
}

export type HolderFormGroup<S extends Slot> = {
  matchId: string;
  matchTitle: string | null;
  zones: { zoneName: string; entries: { slot: S; index: number }[] }[];
};

/**
 * Groups slots by match, then zone, preserving cart order. `index` is the
 * slot's position in the flat list so every field keeps a stable number.
 */
export function groupHolderSlots<S extends Slot>(slots: readonly S[]): HolderFormGroup<S>[] {
  const groups: HolderFormGroup<S>[] = [];
  slots.forEach((slot, index) => {
    let group = groups.find((item) => item.matchId === slot.matchId);
    if (!group) {
      group = { matchId: slot.matchId, matchTitle: slot.matchTitle ?? null, zones: [] };
      groups.push(group);
    }
    let zone = group.zones.find((item) => item.zoneName === slot.zoneName);
    if (!zone) {
      zone = { zoneName: slot.zoneName, entries: [] };
      group.zones.push(zone);
    }
    zone.entries.push({ slot, index });
  });
  return groups;
}

/**
 * The existing `tickets_by_match` payload: one `{ holder_name }` per slot,
 * grouped by match id, in slot order, names trimmed. Unchanged shape.
 */
export function buildTicketsByMatch(slots: readonly Slot[], names: Readonly<Record<string, string>>) {
  return slots.reduce<Record<string, { holder_name: string }[]>>((acc, slot) => {
    acc[slot.matchId] = [...(acc[slot.matchId] ?? []), { holder_name: (names[slot.key] ?? "").trim() }];
    return acc;
  }, {});
}

/* ------------------------------------------------------------------------ *
 * Checkout readiness
 * ------------------------------------------------------------------------ */

export type CheckoutBlocker =
  | "noItems"
  | "expired"
  /** The shared cart gate: an unknown cart outcome must be re-read first. */
  | "reconcile"
  /** A payment for this session has an unknown outcome. */
  | "paymentUnknown"
  /** Another payment attempt for this session is still in progress. */
  | "attemptInProgress"
  | "busy"
  | "holders"
  | "method"
  | "profile"
  | "phone"
  /** The cart session changed since the screen last rendered. */
  | "changed";

/**
 * Every prerequisite the existing flow already requires, plus the owner's
 * expiry: no payment action while the reservation countdown is at zero.
 * The first blocker is what the screen explains; `ready` gates the action.
 */
export function checkoutReadiness({
  itemCount,
  secondsLeft,
  reconciliationRequired = false,
  paymentOutcomeUnknown = false,
  paymentAttemptInProgress = false,
  locked,
  holdersComplete,
  paymentMethod,
  profileComplete,
  phoneValid,
}: {
  itemCount: number;
  secondsLeft: number;
  /** The shared CartContext gate is active for the current session. */
  reconciliationRequired?: boolean;
  /** A payment for the current session has an unknown outcome. */
  paymentOutcomeUnknown?: boolean;
  /** Another attempt holds the current session's payment gate (see `checkoutAttemptBlocks`). */
  paymentAttemptInProgress?: boolean;
  /** Submission in flight or profile refresh (existing `isCheckoutLocked`). */
  locked: boolean;
  holdersComplete: boolean;
  paymentMethod: string | null;
  /** Billing name and email present. */
  profileComplete: boolean;
  phoneValid: boolean;
}): { ready: boolean; blocker: CheckoutBlocker | null } {
  const blocker: CheckoutBlocker | null =
    itemCount === 0 ? "noItems"
      : secondsLeft <= 0 ? "expired"
        : reconciliationRequired ? "reconcile"
          : paymentOutcomeUnknown ? "paymentUnknown"
            : paymentAttemptInProgress ? "attemptInProgress"
            : locked ? "busy"
              : !holdersComplete ? "holders"
                : !paymentMethod ? "method"
                  : !profileComplete ? "profile"
                    : !phoneValid ? "phone"
                      : null;
  return { ready: blocker === null, blocker };
}

/** The owner's state read synchronously at the moment the user presses Pay. */
export type CheckoutOwnerSnapshot = {
  /** Current cart session id (CartContext session authority). */
  sessionId: string | null;
  itemCount: number;
  /** Reservation expiry already reached, from the owner's expires_at. */
  expired: boolean;
  reconciliationRequired: boolean;
  paymentOutcomeUnknown: boolean;
  /** An attempt other than the caller's holds this session's payment gate. */
  paymentAttemptInProgress?: boolean;
};

/**
 * Whether the session's held attempt blocks a new payment from Checkout.
 * The only way through is to continue that same attempt: a BLUE attempt
 * whose validated payment URL is already held (the existing reuse path) may
 * be reopened with BLUE. Anything else (another method, or no reusable URL)
 * would start a second payment for the session.
 */
export function checkoutAttemptBlocks({
  heldMethod,
  paymentMethod,
  hasReusableBlueAttempt,
}: {
  /** Method of the attempt holding the session, or null when none does. */
  heldMethod: "card" | "blue" | null;
  paymentMethod: string | null;
  hasReusableBlueAttempt: boolean;
}) {
  if (heldMethod === null) return false;
  return !(heldMethod === "blue" && paymentMethod === "blue" && hasReusableBlueAttempt);
}

/**
 * Re-validates every prerequisite inside the Pay handler, against the owner's
 * state at the moment of the press rather than the last render. The session
 * that was rendered must still be the current one: a cart that changed,
 * expired or became unconfirmed after the render can never start a handoff.
 */
export function submissionGuard({
  renderedSessionId,
  owner,
  inFlight,
  holdersComplete,
  paymentMethod,
  profileComplete,
  phoneValid,
}: {
  renderedSessionId: string | null;
  owner: CheckoutOwnerSnapshot;
  inFlight: boolean;
  holdersComplete: boolean;
  paymentMethod: string | null;
  profileComplete: boolean;
  phoneValid: boolean;
}): { ok: boolean; blocker: CheckoutBlocker | null } {
  if (owner.sessionId === null || owner.itemCount === 0) return { ok: false, blocker: "noItems" };
  if (owner.sessionId !== renderedSessionId) return { ok: false, blocker: "changed" };
  const readiness = checkoutReadiness({
    itemCount: owner.itemCount,
    secondsLeft: owner.expired ? 0 : 1,
    reconciliationRequired: owner.reconciliationRequired,
    paymentOutcomeUnknown: owner.paymentOutcomeUnknown,
    paymentAttemptInProgress: owner.paymentAttemptInProgress ?? false,
    locked: inFlight,
    holdersComplete,
    paymentMethod,
    profileComplete,
    phoneValid,
  });
  return { ok: readiness.ready, blocker: readiness.blocker };
}

export type PaymentSubmitBlocker =
  /** The owner's session is no longer the one being paid for (or it is empty). */
  | "changed"
  /** The reservation expiry has been reached. */
  | "expired"
  | "reconcile"
  /** This session's payment has an unknown outcome. */
  | "locked"
  /** Another attempt (not the caller's own) holds this session. */
  | "inProgress";

/**
 * The last check, run synchronously immediately before
 * `/checkout/mobile/submit`, against the owner's current state (the same
 * `readCartGuardState` snapshot the Pay handler uses). A payment screen can
 * stay open long after the handoff was validated, so the reservation may
 * have expired, changed or been gated since.
 */
export function paymentSubmitBlocker({
  sessionId,
  owner,
}: {
  /** The session the payment belongs to (the handoff's session). */
  sessionId: string;
  owner: CheckoutOwnerSnapshot;
}): PaymentSubmitBlocker | null {
  if (owner.sessionId === null || owner.sessionId !== sessionId || owner.itemCount === 0) return "changed";
  if (owner.expired) return "expired";
  if (owner.reconciliationRequired) return "reconcile";
  if (owner.paymentOutcomeUnknown) return "locked";
  if (owner.paymentAttemptInProgress) return "inProgress";
  return null;
}

/* ------------------------------------------------------------------------ *
 * BLUE terminal success completion
 * ------------------------------------------------------------------------ */

export type BlueSuccessCompletion =
  /** Cleared for the handoff's session: show the success screen. */
  | "success"
  /** The result belongs to another (or no) reservation: nothing cleared. */
  | "unmatched"
  /**
   * The provider reported success for this session but the clear did not
   * happen (returned nothing or threw): the outcome must be treated as unknown.
   */
  | "unreconciled";

/**
 * Decides what a classified BLUE success redirect may show. Only a clear that
 * actually happened for the handoff's own session is success; a clear that
 * returned nothing or threw never shows success and never retries against
 * another session.
 */
export function blueSuccessCompletion({
  handoffSessionId,
  currentSessionId,
  clear,
}: {
  handoffSessionId: string | null;
  currentSessionId: string | null;
  /** Result of clearCartIfSession for the captured ticket, when attempted. */
  clear: "cleared" | "notCleared" | "threw" | "notAttempted";
}): BlueSuccessCompletion {
  if (!handoffSessionId || currentSessionId !== handoffSessionId || clear === "notAttempted") return "unmatched";
  return clear === "cleared" ? "success" : "unreconciled";
}

/* ------------------------------------------------------------------------ *
 * Leaving a payment screen
 * ------------------------------------------------------------------------ */

/**
 * Whether a payment screen may be left. Reads the synchronous in-flight flag
 * (a ref), so a press that lands before React re-renders is still refused.
 */
export function canLeavePayment(inFlight: { current: boolean }) {
  return !inFlight.current;
}

/* ------------------------------------------------------------------------ *
 * Payment submission failures
 * ------------------------------------------------------------------------ */

export type PaymentFailureKind =
  /** The outcome is unknown (network, timeout, server error): the payment may have gone through. */
  | "unknown"
  /** The backend answered with a rejection: the payment was not completed. */
  | "notCompleted"
  | "session"
  | "maintenance";

/**
 * Classifies a failed `/checkout/mobile/submit` call from HTTP facts only.
 * A request that never got a definite answer is never reported as a
 * failure: the user is told to check their tickets before trying again.
 */
export function paymentFailureKind(facts: { status: number | null; transport: "network" | "timeout" | null }): PaymentFailureKind {
  if (facts.transport) return "unknown";
  if (facts.status === 401 || facts.status === 403) return "session";
  if (facts.status === 503) return "maintenance";
  if (facts.status !== null && facts.status >= 400 && facts.status < 500) return "notCompleted";
  return "unknown";
}

/* ------------------------------------------------------------------------ *
 * Checkout Back (header and Android hardware).
 * ------------------------------------------------------------------------ */

/**
 * Leaving Checkout is unsafe while a submission is in flight or a payment
 * handoff (BLUE page launch / web redirect) has started: the attempt's result
 * could otherwise land on a screen that no longer owns it. Reads the
 * existing synchronous guards only; no new lock.
 */
export function checkoutBackBlocked({ submitInFlight, handoffStarted }: { submitInFlight: boolean; handoffStarted: boolean }) {
  return submitInFlight || handoffStarted;
}

/**
 * One Back policy for both entry points. The header ignores a blocked press;
 * the hardware handler always consumes the event (Checkout never falls back
 * to the default pop) and navigates only when leaving is allowed.
 */
export function checkoutBackHandlers(isBlocked: () => boolean, leave: () => void) {
  const attempt = () => {
    if (isBlocked()) return false;
    leave();
    return true;
  };
  return {
    header: () => {
      attempt();
    },
    hardware: () => {
      attempt();
      return true;
    },
  };
}
