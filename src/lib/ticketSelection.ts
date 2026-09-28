/**
 * Pure rules for Match Details ticket selection. Pure module: no React, no
 * services and no runtime imports, so it stays unit-testable under
 * `node --test`.
 *
 * Everything here describes the screen's transient DRAFT selection and how it
 * compares with the committed cart. None of it is a cart or reservation
 * authority: `CartContext` (backed by the server) owns what is actually in the
 * cart, and the backend owns seat availability and prices.
 */

/** One committed cart line for a zone of the current match, read from CartContext. */
export type ZoneCartLine = {
  quantity: number;
  lockKey: string;
  seatCount: number;
};

type ZoneRef = { id: number; has_seats: boolean };

/**
 * The quantity the GA stepper shows: the user's untouched draft falls back to
 * the committed cart quantity, so returning to the screen shows real cart
 * state without seeding a second copy of it.
 */
export function resolveDraftQuantity(
  drafts: ReadonlyMap<number, number>,
  cartByZone: ReadonlyMap<number, ZoneCartLine>,
  zoneId: number,
) {
  return drafts.get(zoneId) ?? cartByZone.get(zoneId)?.quantity ?? 0;
}

/**
 * add: new line with the chosen quantity (`addItem`);
 * update: SET the existing line to the chosen quantity (`updateItem`);
 * remove: chosen quantity is zero (`removeItem`).
 */
export type GaCartChange =
  | { zoneId: number; action: "add"; from: number; to: number }
  | { zoneId: number; action: "update" | "remove"; from: number; to: number; lockKey: string };

/**
 * The cart requests a GA commit needs, in zone order, one per changed zone.
 * Mirrors the established commit semantics exactly: unchanged zones send
 * nothing; a zone with no committed quantity is added; a zone set to zero is
 * removed; anything else is set (never additively merged).
 */
export function gaCartChanges(
  zones: readonly ZoneRef[],
  draftFor: (zoneId: number) => number,
  cartByZone: ReadonlyMap<number, ZoneCartLine>,
): GaCartChange[] {
  const changes: GaCartChange[] = [];
  for (const zone of zones) {
    if (zone.has_seats) continue;
    const cartLine = cartByZone.get(zone.id);
    const committed = cartLine?.quantity ?? 0;
    const desired = draftFor(zone.id);
    if (desired === committed) continue;
    if (!cartLine || committed === 0) {
      changes.push({ zoneId: zone.id, action: "add", from: committed, to: desired });
    } else if (desired === 0) {
      changes.push({ zoneId: zone.id, action: "remove", from: committed, to: 0, lockKey: cartLine.lockKey });
    } else {
      changes.push({ zoneId: zone.id, action: "update", from: committed, to: desired, lockKey: cartLine.lockKey });
    }
  }
  return changes;
}

/** Whether the confirmation action has anything to send. */
export function hasSelectionChanges(gaChanges: readonly GaCartChange[], pendingSeatCount: number) {
  return gaChanges.length > 0 || pendingSeatCount > 0;
}

/** "add" when the commit only adds tickets; "update" when it changes or removes existing cart lines. */
export function selectionActionKind(gaChanges: readonly GaCartChange[]): "add" | "update" {
  return gaChanges.some((change) => change.action !== "add") ? "update" : "add";
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

export type EstimateLine = { quantity: number; unitPrice: unknown; currency: string | null | undefined };

export type SelectionEstimate = {
  tickets: number;
  /** null when any price is missing/invalid or currencies differ: never a guessed amount. */
  amount: number | null;
  currency: string | null;
  mixedCurrency: boolean;
};

/**
 * Display-only estimate of the draft selection (quantity × backend unit
 * price). The cart response remains the authoritative total; this is never
 * sent anywhere or used to decide anything.
 */
export function selectionEstimate(lines: readonly EstimateLine[]): SelectionEstimate {
  const counted = lines.filter((line) => line.quantity > 0);
  const tickets = counted.reduce((sum, line) => sum + line.quantity, 0);
  const currencies = new Set(counted.map((line) => line.currency ?? ""));
  const mixedCurrency = currencies.size > 1;
  const currency = currencies.size === 1 ? [...currencies][0] || null : null;
  let amount: number | null = tickets > 0 && !mixedCurrency && currency ? 0 : null;
  for (const line of counted) {
    if (amount === null) break;
    const unit = parseAmount(line.unitPrice);
    amount = unit === null ? null : amount + unit * line.quantity;
  }
  return { tickets, amount, currency, mixedCurrency };
}

/** Display-only line subtotal; null when the backend price is not a finite number. */
export function lineSubtotal(quantity: number, unitPrice: unknown) {
  const unit = parseAmount(unitPrice);
  return unit === null ? null : unit * quantity;
}

export type SeatVisualState = "available" | "selected" | "inCart" | "unavailable";

type SeatRef = { id: number; status?: string | null };

/**
 * One state per seat, with the same precedence as the seat's accessible
 * description: a seat already in the cart is "inCart"; otherwise only a seat
 * the backend reports as "available" can be selected.
 */
export function seatVisualState(
  seat: SeatRef,
  selectedIds: readonly number[],
  cartSeatIds: ReadonlySet<number>,
): SeatVisualState {
  if (cartSeatIds.has(seat.id)) return "inCart";
  if (seat.status !== "available") return "unavailable";
  return selectedIds.includes(seat.id) ? "selected" : "available";
}

export function isSeatSelectable(seat: SeatRef, cartSeatIds: ReadonlySet<number>) {
  return seat.status === "available" && !cartSeatIds.has(seat.id);
}

/**
 * Next draft seat selection after tapping `seat`, or null when the tap must
 * be ignored (unavailable or already in the cart). A draft that belongs to
 * another match/zone identity is discarded rather than carried over, and
 * seats that have since reached the cart are dropped from the draft.
 */
export function toggleDraftSeat(
  current: readonly number[],
  seat: SeatRef,
  draftBelongsToActiveZone: boolean,
  cartSeatIds: ReadonlySet<number>,
): number[] | null {
  if (!isSeatSelectable(seat, cartSeatIds)) return null;
  const actionable = draftBelongsToActiveZone
    ? current.filter((seatId) => !cartSeatIds.has(seatId))
    : [];
  return actionable.includes(seat.id)
    ? actionable.filter((seatId) => seatId !== seat.id)
    : [...actionable, seat.id];
}

/** Selected seats resolved against the loaded seat list, in selection order. */
export function orderedSelectedSeats<T extends { id: number }>(seats: readonly T[], selectedIds: readonly number[]) {
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  return selectedIds.flatMap((seatId) => {
    const seat = byId.get(seatId);
    return seat ? [seat] : [];
  });
}

export const SEAT_ZOOM_LEVELS = [1, 1.5, 2] as const;

export function stepSeatZoom(current: number, direction: 1 | -1) {
  const index = SEAT_ZOOM_LEVELS.findIndex((level) => level === current);
  const safeIndex = index === -1 ? 0 : index;
  const next = Math.min(SEAT_ZOOM_LEVELS.length - 1, Math.max(0, safeIndex + direction));
  return SEAT_ZOOM_LEVELS[next];
}

export type TicketErrorContext = "match" | "seats" | "cart";

/** Transport facts extracted from an error by the screen (keeps this module free of service imports). */
export type TicketErrorFacts = {
  status: number | null;
  transport: "network" | "timeout" | null;
};

export type TicketErrorKind =
  | "offline"
  | "timeout"
  | "session"
  | "notFound"
  | "expired"
  | "unavailable"
  | "rejected"
  | "maintenance"
  | "generic";

/**
 * Classifies a failed match/seat/cart request so the screen can show a
 * catalog message instead of a raw backend string. Only HTTP semantics are
 * used; the backend's own wording is never shown.
 */
export function ticketErrorKind(context: TicketErrorContext, facts: TicketErrorFacts): TicketErrorKind {
  if (facts.transport === "network") return "offline";
  if (facts.transport === "timeout") return "timeout";
  switch (facts.status) {
    case 401:
    case 403:
      return "session";
    case 404:
      // A missing match is "not found"; a missing cart line/session means the reservation is gone.
      return context === "match" ? "notFound" : context === "cart" ? "expired" : "generic";
    case 409:
      return context === "match" ? "generic" : "unavailable";
    case 410:
      return context === "cart" ? "expired" : "generic";
    case 422:
      return context === "cart" ? "rejected" : "generic";
    case 503:
      return "maintenance";
    default:
      return "generic";
  }
}

/* ------------------------------------------------------------------------ *
 * Cart-derived views. Read-only projections of CartContext items; they are
 * recomputed from the owner every time and never stored.
 * ------------------------------------------------------------------------ */

/** Structural subset of a CartContext item used by Match Details. */
export type CartLineLike = {
  lock_key: string;
  match_id: string | number;
  stadium_zone_id: string | number;
  type: string;
  quantity?: string | number | null;
  seat_ids?: number[] | null;
  seats?: { id: string | number }[] | null;
};

function lineSeatIds(item: CartLineLike) {
  return item.seat_ids ?? item.seats?.map((seat) => Number(seat.id)) ?? [];
}

/**
 * Per-zone cart state for one match: a GA zone resolves to its single
 * { quantity, lockKey } line; a reserved zone to the number of its seats.
 */
export function cartLinesByZone(items: readonly CartLineLike[], matchId: string) {
  const map = new Map<number, ZoneCartLine>();
  for (const item of items) {
    if (String(item.match_id) !== matchId) continue;
    const zoneId = Number(item.stadium_zone_id);
    if (item.type === "zone") {
      map.set(zoneId, { quantity: Number(item.quantity ?? 0), lockKey: item.lock_key, seatCount: 0 });
      continue;
    }
    const existing = map.get(zoneId);
    map.set(zoneId, {
      quantity: 0,
      lockKey: item.lock_key,
      seatCount: (existing?.seatCount ?? 0) + lineSeatIds(item).length,
    });
  }
  return map;
}

/** Seat ids of one match zone that are already in the cart. */
export function cartSeatIdsForZone(items: readonly CartLineLike[], matchId: string, zoneId: number | null | undefined) {
  return new Set(
    items
      .filter((item) => String(item.match_id) === matchId && String(item.stadium_zone_id) === String(zoneId))
      .flatMap(lineSeatIds),
  );
}

/* ------------------------------------------------------------------------ *
 * Reserved-seat draft revalidation.
 * ------------------------------------------------------------------------ */

export type SeatDraftInput<Seat extends SeatRef> = {
  /** Draft ids after the identity and cart exclusions (`getEffectiveSelectedSeats`). */
  draftIds: readonly number[];
  /**
   * The seat list successfully loaded for the CURRENT match/zone/cart request
   * identity, or null while that request is loading, failed, or not started.
   */
  currentSeats: readonly Seat[] | null;
  cartSeatIds: ReadonlySet<number>;
};

export type SeatDraftState<Seat extends SeatRef> = {
  /** Seats that may be confirmed: present in the current snapshot, available, not in the cart. */
  actionable: Seat[];
  actionableIds: number[];
  /** Drafted ids the current snapshot no longer offers (missing or unavailable). */
  droppedIds: number[];
  /** A draft exists but there is no current snapshot to validate it against. */
  awaitingSnapshot: boolean;
};

/**
 * The single derivation of which drafted seats can be confirmed. The draft
 * itself is kept (useful for retry); only this derived set is ever counted,
 * priced, summarised or sent.
 */
export function actionableSeatDraft<Seat extends SeatRef>({
  draftIds,
  currentSeats,
  cartSeatIds,
}: SeatDraftInput<Seat>): SeatDraftState<Seat> {
  const draft = draftIds.filter((seatId) => !cartSeatIds.has(seatId));
  if (!currentSeats) {
    return { actionable: [], actionableIds: [], droppedIds: [], awaitingSnapshot: draft.length > 0 };
  }
  const byId = new Map(currentSeats.map((seat) => [seat.id, seat]));
  const actionable: Seat[] = [];
  const droppedIds: number[] = [];
  for (const seatId of draft) {
    const seat = byId.get(seatId);
    if (seat && isSeatSelectable(seat, cartSeatIds)) actionable.push(seat);
    else droppedIds.push(seatId);
  }
  return { actionable, actionableIds: actionable.map((seat) => seat.id), droppedIds, awaitingSnapshot: false };
}

export type SelectionPreflight =
  | { canConfirm: true }
  | { canConfirm: false; reason: "nothing" | "seatsPending" };

/**
 * Checked before the FIRST cart mutation. A reserved-seat draft that cannot
 * be validated against the current seat snapshot blocks the whole
 * confirmation, so GA mutations never start ahead of a stale seat selection.
 */
export function selectionPreflight(
  gaChanges: readonly GaCartChange[],
  seatDraft: Pick<SeatDraftState<SeatRef>, "awaitingSnapshot" | "actionableIds">,
): SelectionPreflight {
  if (seatDraft.awaitingSnapshot) return { canConfirm: false, reason: "seatsPending" };
  if (!gaChanges.length && !seatDraft.actionableIds.length) return { canConfirm: false, reason: "nothing" };
  return { canConfirm: true };
}

/* ------------------------------------------------------------------------ *
 * Confirmation: sequential owner mutations, then verification against the
 * cart CartContext actually published for the current session.
 * ------------------------------------------------------------------------ */

export type CommitPlan = {
  matchId: string;
  gaChanges: readonly GaCartChange[];
  seats: { zoneId: number; seatIds: readonly number[] } | null;
};

type Publication<Item> =
  | { confirmed: true; snapshot: { sessionId: string | null; items: Item[] } }
  | { confirmed: false; reason: string };

export type CommitOps<Item extends CartLineLike> = {
  addZone: (zoneId: number, quantity: number) => Promise<Publication<Item>>;
  setZone: (lockKey: string, quantity: number) => Promise<Publication<Item>>;
  removeLine: (lockKey: string) => Promise<Publication<Item>>;
  addSeats: (zoneId: number, seatIds: readonly number[]) => Promise<Publication<Item>>;
  /** The owner's current session id right now (null when there is no cart session). */
  currentSessionId: () => string | null;
};

export type CommitOutcome =
  /** Every intended change is present in the published cart of the current session. */
  | { status: "confirmed" }
  /** A step finished but its result could not be confirmed as the current cart. Outcome unknown. */
  | { status: "unconfirmed"; completedSteps: number }
  /** A step threw. Earlier steps may have been applied and published. */
  | { status: "failed"; completedSteps: number; error: unknown };

/** Whether the published cart reflects every change in the plan. */
export function cartReflectsPlan(plan: CommitPlan, items: readonly CartLineLike[]) {
  const lines = cartLinesByZone(
    items.filter((item) => item.type === "zone"),
    plan.matchId,
  );
  for (const change of plan.gaChanges) {
    const line = lines.get(change.zoneId);
    if (change.action === "remove") {
      if (line && line.quantity > 0) return false;
    } else if (!line || line.quantity !== change.to) {
      return false;
    }
  }
  if (plan.seats && plan.seats.seatIds.length) {
    const inCart = cartSeatIdsForZone(items, plan.matchId, plan.seats.zoneId);
    if (!plan.seats.seatIds.every((seatId) => inCart.has(seatId))) return false;
  }
  return true;
}

/**
 * Runs the plan one awaited owner call at a time (GA in zone order, then the
 * seats). Stops at the first step that throws or whose publication is not
 * confirmed: continuing on an unknown cart could double-apply changes. Success
 * requires the last published snapshot to belong to the owner's current
 * session AND to reflect every change, so a session swap mid-sequence (e.g. a
 * rejected session replaced by a new one) never reads as success.
 */
export async function executeSelectionCommit<Item extends CartLineLike>(
  plan: CommitPlan,
  ops: CommitOps<Item>,
): Promise<CommitOutcome> {
  const steps: (() => Promise<Publication<Item>>)[] = plan.gaChanges.map((change) => {
    if (change.action === "add") return () => ops.addZone(change.zoneId, change.to);
    if (change.action === "remove") return () => ops.removeLine(change.lockKey);
    return () => ops.setZone(change.lockKey, change.to);
  });
  const seats = plan.seats;
  if (seats && seats.seatIds.length) steps.push(() => ops.addSeats(seats.zoneId, seats.seatIds));

  let last: { sessionId: string | null; items: Item[] } | null = null;
  for (let index = 0; index < steps.length; index += 1) {
    let result: Publication<Item>;
    try {
      result = await steps[index]();
    } catch (error) {
      return { status: "failed", completedSteps: index, error };
    }
    if (!result.confirmed) return { status: "unconfirmed", completedSteps: index + 1 };
    last = result.snapshot;
  }

  if (!last) return { status: "unconfirmed", completedSteps: 0 };
  if (ops.currentSessionId() !== last.sessionId) return { status: "unconfirmed", completedSteps: steps.length };
  if (!cartReflectsPlan(plan, last.items)) return { status: "unconfirmed", completedSteps: steps.length };
  return { status: "confirmed" };
}

/**
 * Failures whose outcome is unknown: the request may have been applied, so
 * the cart must be re-read before another attempt instead of replaying it.
 * Definite rejections (conflict, validation, gone, auth) did not apply.
 */
export function failureNeedsReconcile(kind: TicketErrorKind) {
  return kind === "offline" || kind === "timeout" || kind === "generic" || kind === "maintenance";
}

export type CommitEffects = {
  /** Clear drafts, show success and open the cart. */
  success: boolean;
  /** Keep drafts but require a cart refresh before the next confirmation. */
  needsReconcile: boolean;
};

/**
 * What the screen does with an outcome. Drafts are only discarded on a
 * confirmed outcome; otherwise they stay and are re-diffed against whatever
 * the cart authoritatively shows, so an already-applied change is not resent.
 */
export function commitEffects(outcome: CommitOutcome, failureKind: TicketErrorKind | null): CommitEffects {
  if (outcome.status === "confirmed") return { success: true, needsReconcile: false };
  if (outcome.status === "unconfirmed") return { success: false, needsReconcile: true };
  return { success: false, needsReconcile: failureNeedsReconcile(failureKind ?? "generic") };
}

/* ------------------------------------------------------------------------ *
 * Seat touch targets.
 * ------------------------------------------------------------------------ */

export const SEAT_TARGET_MAX = 48;
export const SEAT_TARGET_MIN_RECOMMENDED = 44;

function smallestAxisGap(values: readonly number[]) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < unique.length; index += 1) {
    const gap = unique[index] - unique[index - 1];
    if (gap > 0 && gap < smallest) smallest = gap;
  }
  return smallest;
}

/**
 * Side of the square, invisible press target centred on every seat glyph.
 * Any two distinct seats differ on at least one axis by at least the smallest
 * per-axis gap, so squares of that side never overlap: the target grows up to
 * SEAT_TARGET_MAX where spacing allows and never beyond the nearest neighbour.
 * Geometry is read, never changed; zoom only scales the positions.
 */
export function seatTouchTarget(positions: readonly { px: number; py: number }[], zoom: number, glyphSize: number) {
  const pitch = Math.min(
    smallestAxisGap(positions.map((seat) => seat.px * zoom)),
    smallestAxisGap(positions.map((seat) => seat.py * zoom)),
  );
  const size = Math.max(glyphSize, Math.min(SEAT_TARGET_MAX, pitch));
  return { size, meetsRecommended: size >= SEAT_TARGET_MIN_RECOMMENDED };
}
