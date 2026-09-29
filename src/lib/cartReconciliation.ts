/**
 * Shared "the cart must be re-read" gate, owned by CartContext. Pure module:
 * no React and no runtime imports.
 *
 * When any cart operation ends with an unknown outcome (the request may have
 * been applied but its result was not confirmed), every transaction surface
 * (Match Details, Cart, cart sheet, Checkout, payment handoffs) must stop
 * until the owner has re-read that same session's cart. The gate is scoped
 * to the session it was raised in, so another session's publication can
 * never release it.
 */

export type CartReconciliationReason =
  /** A mutation's result could not be confirmed as published. */
  | "unconfirmed-mutation"
  /** Part of a grouped removal may have been applied. */
  | "partial-removal";

export type CartReconciliation =
  | { required: false }
  | { required: true; sessionId: string | null; reason: CartReconciliationReason };

export const NO_RECONCILIATION: CartReconciliation = { required: false };

export function raiseReconciliation(
  current: CartReconciliation,
  sessionId: string | null,
  reason: CartReconciliationReason,
): CartReconciliation {
  // An existing gate for the same session keeps its first reason.
  if (current.required && current.sessionId === sessionId) return current;
  return { required: true, sessionId, reason };
}

/** Whether the gate applies to the owner's current session. */
export function reconciliationActive(current: CartReconciliation, currentSessionId: string | null) {
  return current.required && current.sessionId === currentSessionId;
}

/**
 * Only a confirmed read of the gated session releases the gate. `readSessionId`
 * is the session the refresh actually read (null when there was no session to
 * read, i.e. the authoritative client cart is empty).
 */
export function releaseAfterRead(
  current: CartReconciliation,
  read: { confirmed: boolean; readSessionId: string | null },
): CartReconciliation {
  if (!current.required || !read.confirmed) return current;
  return read.readSessionId === current.sessionId ? NO_RECONCILIATION : current;
}

/**
 * The owner ended or replaced the gated session (expiry, clear, identity
 * change): that cart no longer exists, so its gate is dropped. A gate for a
 * session that is still current is never dropped here.
 */
export function dropIfSessionEnded(current: CartReconciliation, currentSessionId: string | null) {
  if (!current.required) return current;
  return current.sessionId === currentSessionId ? current : NO_RECONCILIATION;
}

/**
 * A failed cart request whose effect is unknown: transport failures (network,
 * timeout) and server errors. A definite 4xx answer did not apply.
 */
export function failureIsAmbiguous(facts: { status: number | null; transport: "network" | "timeout" | null }) {
  if (facts.transport) return true;
  if (facts.status === null) return true;
  return facts.status >= 500;
}

/* ------------------------------------------------------------------------ *
 * Grouped removal
 * ------------------------------------------------------------------------ */

export type SettledDelete =
  | { lockKey: string; ok: true }
  | { lockKey: string; ok: false; facts: { status: number | null; transport: "network" | "timeout" | null } };

export type GroupedDeleteSummary = {
  applied: string[];
  failed: string[];
  /** Nothing can have been applied: every delete got a definite rejection. */
  nothingApplied: boolean;
  /** Everything was applied. */
  allApplied: boolean;
};

/**
 * What a set of settled per-lock deletes proves. A delete counts as possibly
 * applied if it succeeded or failed ambiguously; only definite rejections
 * prove nothing changed for that lock.
 */
export function summarizeGroupedDelete(results: readonly SettledDelete[]): GroupedDeleteSummary {
  const applied = results.filter((result) => result.ok).map((result) => result.lockKey);
  const failed = results.filter((result) => !result.ok).map((result) => result.lockKey);
  const anyAmbiguous = results.some((result) => !result.ok && failureIsAmbiguous(result.facts));
  return {
    applied,
    failed,
    nothingApplied: applied.length === 0 && !anyAmbiguous,
    allApplied: failed.length === 0,
  };
}

type Facts = { status: number | null; transport: "network" | "timeout" | null };
type Publication = { confirmed: true } | { confirmed: false; reason: string };

export type GroupedRemovalOutcome<P extends Publication> =
  | { status: "notPerformed"; reason: "session-changed" | "reconciliation-required" }
  | { status: "confirmed"; publication: P & { confirmed: true } }
  | { status: "sessionEnded"; applied: string[]; failed: string[] }
  | { status: "ambiguous"; applied: string[]; failed: string[] };

/**
 * The grouped-removal sequence CartContext runs inside its queue, with every
 * dependency injected so it can be exercised deterministically:
 * - nothing is sent for a stale session or while the shared gate is active;
 * - every delete settles individually, so a partial result is known;
 * - all definitely rejected: nothing changed, the first rejection is thrown;
 * - the session is re-checked after the deletes: if it ended (expiry, clear)
 *   the result is `sessionEnded`, never "removed";
 * - a partial result raises the gate (`partial-removal`) and is `ambiguous`;
 * - otherwise only a confirmed publication of the same session is `confirmed`.
 */
export async function runGroupedRemoval<P extends Publication>({
  lockKeys,
  sessionId,
  isSessionCurrent,
  isGateActive,
  remove,
  refresh,
  raiseGate,
  factsOf,
}: {
  lockKeys: readonly string[];
  sessionId: string | null;
  isSessionCurrent: () => boolean;
  isGateActive: () => boolean;
  remove: (lockKey: string) => Promise<unknown>;
  refresh: () => Promise<P>;
  raiseGate: (sessionId: string | null, reason: CartReconciliationReason) => void;
  factsOf: (error: unknown) => Facts;
}): Promise<GroupedRemovalOutcome<P>> {
  if (!isSessionCurrent()) return { status: "notPerformed", reason: "session-changed" };
  if (isGateActive()) return { status: "notPerformed", reason: "reconciliation-required" };

  const settled = await Promise.allSettled(lockKeys.map((lockKey) => remove(lockKey)));
  const results: SettledDelete[] = settled.map((outcome, index) =>
    outcome.status === "fulfilled"
      ? { lockKey: lockKeys[index], ok: true }
      : { lockKey: lockKeys[index], ok: false, facts: factsOf(outcome.reason) },
  );
  const summary = summarizeGroupedDelete(results);

  if (summary.nothingApplied) {
    const rejection = settled.find((outcome) => outcome.status === "rejected");
    throw rejection && rejection.status === "rejected" ? rejection.reason : new Error("Removal failed.");
  }

  if (!isSessionCurrent()) {
    // The session ended while deleting: its empty cart is not proof of this removal.
    return { status: "sessionEnded", applied: summary.applied, failed: summary.failed };
  }

  if (!summary.allApplied) {
    raiseGate(sessionId, "partial-removal");
    await refresh();
    return { status: "ambiguous", applied: summary.applied, failed: summary.failed };
  }

  const publication = await refresh();
  if (publication.confirmed) return { status: "confirmed", publication: publication as P & { confirmed: true } };
  if (publication.reason === "session-ended") {
    return { status: "sessionEnded", applied: summary.applied, failed: [] };
  }
  raiseGate(sessionId, "unconfirmed-mutation");
  return { status: "ambiguous", applied: summary.applied, failed: [] };
}

/** Lock keys of a line that the current published cart still holds (the retry plan). */
export function remainingLockKeys(lockKeys: readonly string[], items: readonly { lock_key: string }[]) {
  const present = new Set(items.map((item) => item.lock_key));
  return lockKeys.filter((lockKey) => present.has(lockKey));
}
