/**
 * What a CartContext mutation or refresh actually published. Pure module:
 * no React and no runtime imports.
 *
 * A resolved mutation promise only means the operation finished. It is
 * `confirmed` only when the resulting cart was published through the
 * existing session-guarded path for the session that is current at that
 * moment; the snapshot is exactly what was published. Anything else (session
 * replaced or expired, refresh failed, publication skipped) is `unconfirmed`:
 * the backend may or may not have applied the change, so callers must not
 * report success or replay the mutation blindly.
 */

export type CartPublicationSnapshot<Item> = {
  /** Session the published cart belongs to; null when the cart was authoritatively emptied and cleared. */
  sessionId: string | null;
  items: Item[];
};

export type CartPublicationUnconfirmedReason =
  | "unauthenticated"
  | "session-changed"
  | "session-ended"
  | "refresh-failed"
  /** Refused: the shared cart gate requires a confirmed re-read first (nothing was sent). */
  | "reconciliation-required";

export type CartPublicationResult<Item> =
  | { confirmed: true; snapshot: CartPublicationSnapshot<Item> }
  | { confirmed: false; reason: CartPublicationUnconfirmedReason };

export function confirmedPublication<Item>(sessionId: string | null, items: Item[]): CartPublicationResult<Item> {
  return { confirmed: true, snapshot: { sessionId, items } };
}

export function unconfirmedPublication<Item>(reason: CartPublicationUnconfirmedReason): CartPublicationResult<Item> {
  return { confirmed: false, reason };
}
