/**
 * Session-scoped payment gate: the one shared authority for "may a payment
 * start for this cart session?". Pure module: no React, no runtime imports;
 * persistence is injected by the cart owner (`configurePaymentOutcomeStore`
 * in `CartContext.tsx`). It decides no payment status; the backend and
 * portal remain the authority.
 *
 * Two states block a session:
 *
 * 1. The unknown-outcome lock. Set when a payment submission (card or BLUE)
 *    may have reached the backend or provider but no trustworthy result came
 *    back, or when a provider success could not be reconciled with the cart.
 *    Backend idempotency is not established and there is no API to look the
 *    result up, so the lock is released only by a materially new cart session
 *    (a different session id), never by navigation.
 *
 * 2. The attempt in progress. Every submission first *acquires* the session's
 *    attempt (synchronously, so two surfaces can never both hold it), and the
 *    acquisition is persisted before anything is sent. While it is held, no
 *    other surface or method may start a payment for that session; only the
 *    holder, identified by its attempt id, passes its own final guard. It is
 *    released by a definite "nothing was charged" answer (`settle`), becomes
 *    the lock on an unknown outcome (`markPaymentOutcomeUnknown`), and ends
 *    with the session when a trusted success clears the cart.
 *
 * A parked BLUE attempt. When the user leaves the BLUE page without a
 * terminal result, the BLUE request (its backend order and `payment_url`) may
 * still be open, so its attempt is *parked* (`parkPaymentAttempt`): its
 * record stays persisted, but it no longer blocks the session. Another method
 * may then acquire an attempt of its own (a card submit is a separate backend
 * order; the BLUE order is never reused for it); BLUE re-acquires the same
 * parked attempt to resume its stored URL. While another attempt runs on top
 * of the parked one, the record names that attempt's method; settling it
 * restores the parked record. A trusted success clears the session, and an
 * unknown outcome locks it, ending the parked attempt either way.
 *
 * Restart safety. The cart session id is persisted and restored by
 * `CartContext`, so in-memory state alone would disappear with the process
 * and the restored session would become payable again. When `CartContext`
 * restores a session, a persisted record for that same session becomes the
 * lock: after a restart an unsettled attempt is, by definition, an unknown
 * outcome. A record for any other session is discarded, so a stale record or
 * attempt never blocks an unrelated or new session.
 */

export type PaymentMethodKind = "card" | "blue";

export type PaymentOutcomeLock = {
  sessionId: string;
  /** "unknown" when the lock was restored without a readable method. */
  method: PaymentMethodKind | "unknown";
};

/** The held attempt; `id` is the acquisition identity only its owner has. */
export type PaymentAttempt = Readonly<{
  id: number;
  sessionId: string;
  method: PaymentMethodKind;
}>;

export type PaymentAttemptAcquisition =
  | { ok: true; attempt: PaymentAttempt }
  /** blocked: the session is locked or another attempt holds it. notRecorded: the attempt could not be persisted. Nothing was sent either way. */
  | { ok: false; reason: "blocked" | "notRecorded" };

/** Minimal async key/value adapter for the one persisted record. */
export type PaymentOutcomeStore = {
  get: () => Promise<string | null>;
  set: (value: string) => Promise<void>;
  remove: () => Promise<void>;
};

const RECORD_VERSION = 1;

let lock: PaymentOutcomeLock | null = null;
let attempt: PaymentAttempt | null = null;
/** A BLUE attempt whose page was left without a result; blocks nothing, keeps its record. */
let parked: PaymentAttempt | null = null;
let attemptSequence = 0;
let store: PaymentOutcomeStore | null = null;
let tail: Promise<unknown> = Promise.resolve();

/** Serializes every persisted read/write so record and settle never interleave. */
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = tail.then(operation, operation);
  tail = next.catch(() => undefined);
  return next;
}

function serializeRecord(sessionId: string, method: PaymentOutcomeLock["method"]) {
  return JSON.stringify({ version: RECORD_VERSION, sessionId, method });
}

/** The persisted record, or "malformed" when something unreadable is stored. */
export function parsePaymentOutcomeRecord(raw: string | null): PaymentOutcomeLock | "malformed" | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<{ version: number; sessionId: unknown; method: unknown }>;
    if (
      value
      && value.version === RECORD_VERSION
      && typeof value.sessionId === "string"
      && value.sessionId.trim()
    ) {
      const method = value.method === "card" || value.method === "blue" ? value.method : "unknown";
      return { sessionId: value.sessionId, method };
    }
  } catch {
    // Fall through: unreadable.
  }
  return "malformed";
}

export function configurePaymentOutcomeStore(next: PaymentOutcomeStore | null) {
  store = next;
}

export function markPaymentOutcomeUnknown(sessionId: string, method: PaymentMethodKind) {
  lock = { sessionId, method };
  // The lock supersedes the attempt (and any parked one): the session stays blocked for everyone.
  if (attempt?.sessionId === sessionId) attempt = null;
  if (parked?.sessionId === sessionId) parked = null;
  const current = store;
  // The attempt was already recorded before its submit; this keeps the
  // record in place (idempotent) for locks raised without a prior record.
  if (current) void enqueue(() => current.set(serializeRecord(sessionId, method))).catch(() => undefined);
}

/** The unknown-outcome lock for this session, or null. Another session never inherits it. */
export function readPaymentOutcomeLock(sessionId: string | null): PaymentOutcomeLock | null {
  return sessionId !== null && lock?.sessionId === sessionId ? lock : null;
}

/** The attempt in progress for this session, or null. A parked attempt is not in progress. */
export function readPaymentAttempt(sessionId: string | null): PaymentAttempt | null {
  return sessionId !== null && attempt?.sessionId === sessionId ? attempt : null;
}

/** The parked BLUE attempt for this session, or null. */
export function readParkedPaymentAttempt(sessionId: string | null): PaymentAttempt | null {
  return sessionId !== null && parked?.sessionId === sessionId ? parked : null;
}

/**
 * The BLUE page was left without a terminal result: the in-progress BLUE
 * attempt for this session stops blocking other methods but keeps its record
 * (so a restart still fails closed). Only an in-progress BLUE attempt parks.
 */
export function parkPaymentAttempt(sessionId: string) {
  if (attempt?.sessionId !== sessionId || attempt.method !== "blue") return;
  parked = attempt;
  attempt = null;
}

/**
 * Whether an attempt other than `own` holds this session. The holder passes
 * its own id; every competing surface passes null.
 */
export function isPaymentAttemptHeldByOther(sessionId: string | null, own: PaymentAttempt | null) {
  const held = readPaymentAttempt(sessionId);
  return held !== null && held.id !== own?.id;
}

/** Test/owner helper: forget a lock and attempt for a session that no longer exists. */
export function clearPaymentOutcomeLockUnlessSession(sessionId: string | null) {
  if (lock && lock.sessionId !== sessionId) lock = null;
  if (attempt && attempt.sessionId !== sessionId) attempt = null;
  if (parked && parked.sessionId !== sessionId) parked = null;
}

/**
 * Acquires the session's payment attempt, then persists it. The claim is
 * synchronous: a second caller (any surface, any method) is refused before
 * this one awaits anything. Must resolve `ok` before `/checkout/mobile/submit`
 * is called; if the record cannot be written, the claim is released and the
 * caller does not submit (nothing is sent, so nothing is lost).
 */
export function acquirePaymentAttempt(sessionId: string, method: PaymentMethodKind): Promise<PaymentAttemptAcquisition> {
  if (readPaymentOutcomeLock(sessionId) || readPaymentAttempt(sessionId)) {
    return Promise.resolve({ ok: false, reason: "blocked" });
  }
  const current = store;
  if (!current) return Promise.resolve({ ok: false, reason: "notRecorded" });
  // Resuming the parked BLUE attempt re-holds that same attempt (its record is already persisted).
  const resumed = readParkedPaymentAttempt(sessionId);
  if (resumed && resumed.method === method) {
    parked = null;
    attempt = resumed;
    return enqueue(async () => {
      await current.set(serializeRecord(sessionId, method));
    }).then(
      (): PaymentAttemptAcquisition => ({ ok: true, attempt: resumed }),
      (): PaymentAttemptAcquisition => {
        if (attempt?.id === resumed.id) {
          attempt = null;
          parked = resumed;
        }
        return { ok: false, reason: "notRecorded" };
      },
    );
  }
  attemptSequence += 1;
  const claimed: PaymentAttempt = { id: attemptSequence, sessionId, method };
  attempt = claimed;
  return enqueue(async () => {
    await current.set(serializeRecord(sessionId, method));
  }).then(
    (): PaymentAttemptAcquisition => ({ ok: true, attempt: claimed }),
    (): PaymentAttemptAcquisition => {
      if (attempt?.id === claimed.id) attempt = null;
      return { ok: false, reason: "notRecorded" };
    },
  );
}

/**
 * A definite answer that this session's attempt charged nothing (a backend
 * rejection, a provider failure redirect, or a submit that was never sent):
 * release the attempt and remove its record. With `attemptId`, only that
 * attempt is settled. A session that holds the unknown-outcome lock keeps it.
 */
export function settlePaymentAttempt(sessionId: string, attemptId?: number): Promise<void> {
  if (readPaymentOutcomeLock(sessionId)) return Promise.resolve();
  const held = readPaymentAttempt(sessionId);
  if (held && attemptId !== undefined && held.id !== attemptId) return Promise.resolve();
  if (held) attempt = null;
  const current = store;
  if (!current) return Promise.resolve();
  return enqueue(async () => {
    // A newer attempt (or a lock) for this session may have been acquired meanwhile.
    if (readPaymentOutcomeLock(sessionId) || readPaymentAttempt(sessionId)) return;
    // A parked BLUE request is still open: its record comes back, not removed.
    const stillParked = readParkedPaymentAttempt(sessionId);
    if (stillParked) {
      await current.set(serializeRecord(sessionId, stillParked.method));
      return;
    }
    const record = parsePaymentOutcomeRecord(await current.get());
    if (record !== null && record !== "malformed" && record.sessionId === sessionId) await current.remove();
  }).catch(() => undefined);
}

/**
 * Called by the cart owner when a new, different session becomes current:
 * a lock, attempt or record for any other session no longer applies.
 */
export function discardPaymentOutcomeUnlessSession(sessionId: string) {
  clearPaymentOutcomeLockUnlessSession(sessionId);
  const current = store;
  if (!current) return Promise.resolve();
  return enqueue(async () => {
    const record = parsePaymentOutcomeRecord(await current.get());
    if (record === null) return;
    if (record === "malformed" || record.sessionId !== sessionId) await current.remove();
  }).catch(() => undefined);
}

/**
 * Called by the cart owner while restoring the persisted cart session, before
 * that session is published. A record for the restored session becomes its
 * lock; anything else is discarded. Fails closed: if the record cannot be
 * read (or is unreadable) while a session is being restored, that session is
 * locked, because an unsettled payment attempt cannot be ruled out.
 * Never throws.
 */
export function restorePaymentOutcomeLock(sessionId: string | null): Promise<void> {
  // An in-memory lock or attempt for the same session (same process) is kept as-is.
  clearPaymentOutcomeLockUnlessSession(sessionId);
  const current = store;
  if (!current) return Promise.resolve();
  return enqueue(async () => {
    let raw: string | null;
    try {
      raw = await current.get();
    } catch {
      if (sessionId !== null && !readPaymentAttempt(sessionId)) lock = { sessionId, method: "unknown" };
      return;
    }
    const record = parsePaymentOutcomeRecord(raw);
    if (record === null) return;
    if (sessionId !== null && (record === "malformed" || record.sessionId === sessionId)) {
      // Same process: the live attempt still owns its record.
      if (readPaymentAttempt(sessionId)) return;
      lock = { sessionId, method: record === "malformed" ? "unknown" : record.method };
      if (record === "malformed") await current.set(serializeRecord(sessionId, "unknown"));
      return;
    }
    await current.remove();
  }).catch(() => undefined);
}
