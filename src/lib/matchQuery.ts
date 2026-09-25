/**
 * Filter-identity bookkeeping for match queries (pure module, unit-tested).
 *
 * The owner (`useScheduledMatches`) keeps one snapshot: the last successful
 * items tagged with the filter identity that produced them, plus the latest
 * error tagged the same way. What the screen may show is derived for the
 * CURRENTLY selected identity, so results are never presented under filters
 * they did not come from.
 */

export type MatchQuerySnapshot<T> = {
  items: T[];
  /** Filter identity of the successful request that produced `items`. */
  itemsIdentity: string | null;
  error: string | null;
  /** Filter identity of the request that failed with `error`. */
  errorIdentity: string | null;
};

export function emptyMatchQuerySnapshot<T>(): MatchQuerySnapshot<T> {
  return { items: [], itemsIdentity: null, error: null, errorIdentity: null };
}

/** A successful response replaces the items and clears any error. */
export function applyQuerySuccess<T>(identity: string, items: T[]): MatchQuerySnapshot<T> {
  return { items, itemsIdentity: identity, error: null, errorIdentity: null };
}

/** A failure keeps the previous items (they may still be valid for their own identity). */
export function applyQueryFailure<T>(snapshot: MatchQuerySnapshot<T>, identity: string, error: string): MatchQuerySnapshot<T> {
  return { ...snapshot, error, errorIdentity: identity };
}

/**
 * What may be presented for `selectedIdentity`:
 * - items only when they came from that same identity (a failed refresh of
 *   the same filters keeps them; a failed switch to new filters does not);
 * - the error only when it belongs to that identity.
 */
export function matchQueryView<T>(snapshot: MatchQuerySnapshot<T>, selectedIdentity: string) {
  return {
    items: snapshot.itemsIdentity === selectedIdentity ? snapshot.items : [],
    hasItemsForSelection: snapshot.itemsIdentity === selectedIdentity,
    error: snapshot.errorIdentity === selectedIdentity ? snapshot.error : null,
  };
}
