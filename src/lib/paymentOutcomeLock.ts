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
 *    result up. Navigation never releases the lock; an explicit user
 *    confirmation may allow a new payment without resolving the old result.
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
 *
 * Unresolved card results (account scope). With CyberSource autoProcessing,
 * the card form itself may authorize the payment before the app has an
 * order: the result it returns is the only client-side evidence. Every such
 * result is recorded here (`recordUnresolvedCardResult`) before anything
 * else is checked, bound to the account and cart session it came from. Only
 * a marker is persisted (account, session, time, support reference, key),
 * never the result itself or any checkout details. Until a submit response
 * that identifies an order resolves it (`resolveUnresolvedCardResult`), it
 * blocks every payment method on its own checkout session, and new card
 * payments for that account on any other session: a new cart, a restart or
 * an account switch never makes card payable again. It never blocks BLUE on
 * an unrelated session (see `readPaymentOutcomeLock`). If the markers cannot
 * be read, card stays paused for the account, and a checkout session restored
 * from an earlier launch is blocked for every method (it may have one) until
 * a retried read succeeds; a new checkout session can still pay with BLUE.
 * A resolution never races a pending marker write: its removal is queued
 * behind the write, so a write landing late cannot revive it. Its claims
 * (status, id) are decoded only for a support reference; they are unverified
 * and never decide anything. No marker expires. A confirmed new-payment
 * choice bypasses existing markers for that checkout in this process only;
 * it never resolves them. Writes and removals that did not reach storage are reported
 * and retried in this process; a relaunch never silently unlocks a saved
 * marker or revives a resolved one (see `unresolvedCardResultStore.ts`).
 *
 * Not covered: if the app dies before the card form hands its result to
 * the app, nothing reaches this module. Only backend reconciliation with
 * CyberSource can recover that payment.
 */

export type PaymentMethodKind = "card" | "blue";

export type PaymentOutcomeLock = {
  sessionId: string;
  /** "unknown" when the lock was restored without a readable method. */
  method: PaymentMethodKind | "unknown";
  /** "account": an unresolved card result (or an unreadable record) blocks card payments on every session of the account. */
  scope?: "account";
  /**
   * "unreadable": this session existed before the app started and the
   * device's card-result markers cannot be read, so an unresolved card result
   * for it cannot be ruled out. Retrying the read (`selectPaymentAccount`)
   * can release it; a new checkout session is never affected.
   */
  reason?: "unreadable";
};

/** Account slot for a result whose originating account is unknown: it blocks every account, and shows to none. */
export const UNBOUND_PAYMENT_ACCOUNT = "unbound";

/** The persisted marker of an unresolved card result. No payment JWT, billing details or holder names. */
export type UnresolvedCardResult = Readonly<{
  key: string;
  accountId: string;
  sessionId: string;
  recordedAt: number;
  /** Unverified reference decoded from the result, for support only. */
  reference: string | null;
}>;

/**
 * Per-account marker storage. `read` throws when anything stored is
 * unreadable; `add` and `remove` reject when no store accepted the change.
 */
export type UnresolvedCardResultStore = {
  read: (accountId: string) => Promise<{ markers: UnresolvedCardResult[]; needsCompaction: boolean }>;
  add: (accountId: string, marker: UnresolvedCardResult) => Promise<"primary" | "ledger">;
  remove: (accountId: string, key: string) => Promise<"removed" | "tombstoned">;
  compact: (accountId: string) => Promise<void>;
};

/** Identifies the result its recorder may still submit (it passes its own gate). */
export type CardResultClaim = Readonly<{ key: string; accountId: string; sessionId: string }>;

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

let resultStore: UnresolvedCardResultStore | null = null;
/** Markers recorded in this process and not yet resolved, by account: they survive account switches and failed writes. */
const recordedResults = new Map<string, UnresolvedCardResult[]>();
/** Marker keys whose write reached no store yet (retried on the next account selection). */
const unsavedKeys = new Set<string>();
/** Resolved marker keys whose removal reached no store yet, by account (retried; never shown as unresolved here). */
const pendingCleanups = new Map<string, Set<string>>();
/**
 * Every marker key resolved in this process. Never shown as unresolved again
 * here, whatever a later read, account switch or stale load returns.
 */
const resolvedKeys = new Set<string>();
/**
 * Marker writes queued or running, by key. A resolution that lands while a
 * write is pending must queue its removal behind that write: the write may
 * still reach storage, and it would then revive the marker after a relaunch.
 */
const writesInFlight = new Map<string, number>();
/**
 * Cart sessions restored from storage in this process (they existed in an
 * earlier one). Only these can have markers this process cannot read: every
 * marker for a session first seen in this process is in memory.
 */
const restoredSessions = new Set<string>();
/** User-acknowledged marker keys, scoped to account + checkout; never persisted as payment success. */
const acknowledgedMarkers = new Map<string, Set<string>>();
const acknowledgementKey = (accountId: string | null, sessionId: string) => JSON.stringify([accountId, sessionId]);
const markerAcknowledged = (sessionId: string, key: string) =>
  acknowledgedMarkers.get(acknowledgementKey(paymentAccount.id, sessionId))?.has(key) ?? false;

function trackWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
  writesInFlight.set(key, (writesInFlight.get(key) ?? 0) + 1);
  const done = () => {
    const count = (writesInFlight.get(key) ?? 1) - 1;
    if (count > 0) writesInFlight.set(key, count);
    else writesInFlight.delete(key);
  };
  const pending = write();
  pending.then(done, done);
  return pending;
}

/** Two independent 32-bit FNV-1a hashes: a 64-bit fingerprint of the result. */
export function cardResultKey(result: string) {
  let first = 0x811c9dc5;
  let second = 0x01000193 ^ result.length;
  for (let index = 0; index < result.length; index += 1) {
    const code = result.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x5bd1e995) >>> 0;
    second ^= second >>> 15;
  }
  return `c${first.toString(36)}${second.toString(36).padStart(7, "0")}`;
}
/**
 * The signed-in account whose payments are being gated. "loading" and
 * "failed" block (fail closed): an unresolved result cannot be ruled out.
 */
let paymentAccount: {
  id: string | null;
  status: "none" | "loading" | "ready" | "failed";
  stored: UnresolvedCardResult[];
  generation: number;
} = { id: null, status: "none", stored: [], generation: 0 };
let paymentAccountLoad: Promise<void> = Promise.resolve();
/** Sessions with a card form on screen (a payment may complete inside it at any moment). */
const openCardForms = new Map<string, number>();

/** Serializes every persisted read/write so record and settle never interleave. */
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = tail.then(operation, operation);
  tail = next.catch(() => undefined);
  return next;
}

let resultTail: Promise<unknown> = Promise.resolve();
/**
 * Serializes the unresolved-card-result store on its own queue. It holds
 * different keys from the attempt/lock record, so a slow marker write (chunked
 * SecureStore writes, each read back) never delays acquiring the attempt and
 * sending the submit for a payment the card form may already have taken.
 */
function enqueueResult<T>(operation: () => Promise<T>): Promise<T> {
  const next = resultTail.then(operation, operation);
  resultTail = next.catch(() => undefined);
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

/** This session's own unknown-outcome lock (session scope only). */
function sessionLock(sessionId: string | null): PaymentOutcomeLock | null {
  return sessionId !== null && lock?.sessionId === sessionId ? lock : null;
}

/** Account slots whose markers apply to this account: its own, plus markers recorded without an account. */
function slotsFor(accountId: string) {
  return accountId === UNBOUND_PAYMENT_ACCOUNT ? [accountId] : [accountId, UNBOUND_PAYMENT_ACCOUNT];
}

/** The current account's unresolved markers; markers resolved in this process (cleanup pending) are excluded. */
function accountResults(): UnresolvedCardResult[] {
  const id = paymentAccount.id;
  if (id === null) return [];
  const slots = slotsFor(id);
  const merged: UnresolvedCardResult[] = [];
  for (const entry of [...paymentAccount.stored, ...slots.flatMap((slot) => recordedResults.get(slot) ?? [])]) {
    if (resolvedKeys.has(entry.key)) continue;
    if (!merged.some((known) => known.key === entry.key)) merged.push(entry);
  }
  return merged;
}

/** Whether the current account may not start a payment; `own` is the one result its recorder may still submit. */
function accountBlocks(sessionId: string, own: CardResultClaim | null) {
  if (paymentAccount.id === null) return false;
  if (paymentAccount.status !== "ready") return true;
  return accountResults().some((entry) => entry.key !== own?.key && !markerAcknowledged(sessionId, entry.key));
}

/**
 * Retries, for this account's slots, marker writes that reached no store and
 * removals of resolved markers that reached no store, then compacts storage
 * (folding the ledger in and rewriting version-1 records as markers). Best
 * effort; never throws.
 */
async function flushAccountStorage(accountId: string) {
  const current = resultStore;
  if (!current) return;
  for (const slot of slotsFor(accountId)) {
    for (const entry of recordedResults.get(slot) ?? []) {
      if (!unsavedKeys.has(entry.key)) continue;
      await trackWrite(entry.key, () => enqueueResult(() => addIfLive(current, slot, entry))).then(() => unsavedKeys.delete(entry.key), () => undefined);
    }
    for (const key of [...(pendingCleanups.get(slot) ?? [])]) {
      await enqueueResult(() => current.remove(slot, key)).then(() => pendingCleanups.get(slot)?.delete(key), () => undefined);
    }
    await enqueueResult(() => current.compact(slot)).catch(() => undefined);
  }
}

/** A queued write runs only if the marker is still unresolved when its turn comes. */
async function addIfLive(current: UnresolvedCardResultStore, slot: string, entry: UnresolvedCardResult) {
  if (!(recordedResults.get(slot) ?? []).some((known) => known.key === entry.key)) return "skipped" as const;
  return current.add(slot, entry);
}


/**
 * Whether an unresolved card result was (or may have been) recorded for this
 * very checkout session, other than `own`:
 * - "marker": one is known (persisted, or recorded in this process);
 * - "loading": the account's markers are still being read (blocks briefly);
 * - "unreadable": they cannot be read, and the session was restored from
 *   storage, so it may have one. A session first seen in this process cannot
 *   have a marker this process does not hold in memory, so it is not blocked.
 */
function sessionMarkerBlock(sessionId: string, own: CardResultClaim | null): "marker" | "loading" | "unreadable" | null {
  if (paymentAccount.id === null) return null;
  if (accountResults().some((entry) => entry.key !== own?.key && entry.sessionId === sessionId && !markerAcknowledged(sessionId, entry.key))) return "marker";
  if (paymentAccount.status === "loading") return "loading";
  if (paymentAccount.status === "failed" && restoredSessions.has(sessionId)) return "unreadable";
  return null;
}

/**
 * The lock that blocks a payment for this session, or null. `own` lets the
 * recorder of a result pass its own gate; every other caller passes nothing.
 * - The session's own unknown-outcome lock blocks every method.
 * - An unresolved card result recorded for this same checkout session blocks
 *   every method: that checkout may already be paid. So does a session
 *   restored from storage while the markers cannot be read (`reason:
 *   "unreadable"`): a marker for it cannot be ruled out. That block ends when
 *   a retried read succeeds or the checkout session ends.
 * - Scope "account": an unresolved card result from another session (or
 *   markers that could not be read) blocks new **card** payments only. Pass
 *   `method: "blue"` for a BLUE gate: such a marker never blocks an unrelated
 *   BLUE checkout, so unreadable storage or an old card result can never
 *   stop the account paying with BLUE on a new checkout. Without `method`
 *   the account lock is returned (for notices and card gates).
 */
export function readPaymentOutcomeLock(
  sessionId: string | null,
  own: CardResultClaim | null = null,
  method?: PaymentMethodKind,
): PaymentOutcomeLock | null {
  const sessionScoped = sessionLock(sessionId);
  if (sessionScoped || sessionId === null) return sessionScoped;
  const markerBlock = sessionMarkerBlock(sessionId, own);
  if (markerBlock === "unreadable") return { sessionId, method: "card", reason: "unreadable" };
  if (markerBlock) return { sessionId, method: "card" };
  if (method === "blue") return null;
  return accountBlocks(sessionId, own) ? { sessionId, method: "card", scope: "account" } : null;
}

/**
 * Prepare BEFORE showing the pay-again confirmation, then invoke only if accepted.
 * Consent covers exactly the observed lock/markers, account and live checkout.
 * A new result, active payment or account change refuses it.
 * Old markers stay unresolved and durable; a restart asks again. The next
 * attempt still acquires and persists the normal shared single-flight gate.
 */
export function prepareNewPaymentAfterUnknown(
  sessionId: string,
  accountId: string,
  isCurrent: () => boolean,
): (() => Promise<boolean>) | null {
  if (paymentAccount.id !== accountId || paymentAccount.status !== "ready" || !readPaymentOutcomeLock(sessionId)) return null;
  const generation = paymentAccount.generation;
  const previousLock = sessionLock(sessionId);
  const previousParked = readParkedPaymentAttempt(sessionId);
  const keys = accountResults().map((entry) => entry.key);
  const currentStore = store;
  let consumed = false;
  const valid = () => isCurrent()
    && paymentAccount.id === accountId && paymentAccount.generation === generation && paymentAccount.status === "ready"
    && store === currentStore && sessionLock(sessionId) === previousLock
    && !readPaymentAttempt(sessionId) && readParkedPaymentAttempt(sessionId) === previousParked && openCardForms.size === 0
    && accountResults().every((entry) => keys.includes(entry.key));
  if (!currentStore || !valid()) return null;
  return () => {
    if (consumed) return Promise.resolve(false);
    consumed = true;
    return enqueue(async () => {
      if (!valid()) return false;
      // Keep the durable record: a restart before the new attempt asks again.
      // Acquisition must overwrite it successfully before any new submit.
      if (previousLock) lock = null;
      if (previousParked) parked = null;
      acknowledgedMarkers.set(acknowledgementKey(accountId, sessionId), new Set(keys));
      return true;
    }).catch(() => false);
  };
}

export function configureUnresolvedCardResultStore(next: UnresolvedCardResultStore | null) {
  resultStore = next;
}

/**
 * Called by the cart owner when the signed-in account changes (null when
 * signed out). Loads that account's persisted markers; until they are read,
 * or if they cannot be read, the account's payments are blocked. Another
 * account's markers are never loaded or shown. Calling it again for the
 * same account retries a failed read and any unsaved write or removal.
 * Never throws.
 */
export function selectPaymentAccount(accountId: string | null): Promise<void> {
  const id = accountId?.trim() || null;
  if (id === paymentAccount.id && paymentAccount.status === "ready") {
    // Retries unsaved writes and removals, and deletion of superseded chunks
    // (which can hold a version-1 JWT and personal details).
    return id !== null ? flushAccountStorage(id) : Promise.resolve();
  }
  if (id === paymentAccount.id && paymentAccount.status === "loading") return paymentAccountLoad;
  if (id !== paymentAccount.id) acknowledgedMarkers.clear();
  const generation = paymentAccount.generation + 1;
  paymentAccount = { id, status: id === null ? "none" : "loading", stored: [], generation };
  const current = resultStore;
  if (id === null) {
    paymentAccountLoad = Promise.resolve();
  } else if (!current) {
    paymentAccount = { ...paymentAccount, status: "failed" };
    paymentAccountLoad = Promise.resolve();
  } else {
    paymentAccountLoad = enqueueResult(async () => {
      const stored: UnresolvedCardResult[] = [];
      for (const slot of slotsFor(id)) stored.push(...(await current.read(slot)).markers);
      return stored;
    }).then(
      async (stored) => {
        if (paymentAccount.generation !== generation) return;
        paymentAccount = { ...paymentAccount, status: "ready", stored };
        await flushAccountStorage(id);
      },
      () => {
        if (paymentAccount.generation === generation) paymentAccount = { ...paymentAccount, status: "failed" };
      },
    );
  }
  return paymentAccountLoad;
}

/**
 * The current account's own unresolved results (never another account's,
 * and never an unbound one's details). For support display only.
 */
export function readUnresolvedCardResults(): readonly UnresolvedCardResult[] {
  const id = paymentAccount.id;
  return paymentAccount.status === "ready" ? accountResults().filter((entry) => entry.accountId === id) : [];
}

/**
 * Records a result the card form returned, before any other check. The
 * account is blocked synchronously. Only a marker is persisted; the raw
 * result stays in memory (to recognise a repeated callback) and is never
 * written. `persisted` is true only when a durable store accepted the
 * marker; false means it lives only in this process (the caller must say
 * so) and the write is retried on the next account selection.
 */
export function recordUnresolvedCardResult(input: {
  accountId: string | null;
  sessionId: string | null;
  result: string;
  reference: string | null;
}): { claim: CardResultClaim; persisted: Promise<boolean> } {
  const accountId = input.accountId?.trim() || UNBOUND_PAYMENT_ACCOUNT;
  const list = recordedResults.get(accountId) ?? [];
  const key = cardResultKey(input.result);
  if (resolvedKeys.has(key)) {
    // A late repeat of a result already resolved in this process: nothing to record.
    return { claim: { key, accountId, sessionId: input.sessionId?.trim() || "unknown" }, persisted: Promise.resolve(true) };
  }
  const known = list.find((entry) => entry.key === key);
  let entry: UnresolvedCardResult;
  if (known) {
    entry = known;
  } else {
    const recordedAt = Date.now();
    entry = {
      // A fingerprint of the result: unique per payment result in every tab
      // and process, the same for a repeated delivery. The result itself is
      // never stored.
      key,
      accountId,
      sessionId: input.sessionId?.trim() || "unknown",
      recordedAt,
      reference: input.reference,
    };
    unsavedKeys.add(entry.key);
    recordedResults.set(accountId, [...list, entry]);
  }
  const claim: CardResultClaim = { key: entry.key, accountId, sessionId: entry.sessionId };
  const current = resultStore;
  if (!current) return { claim, persisted: Promise.resolve(false) };
  const persisted = trackWrite(entry.key, () => enqueueResult(() => addIfLive(current, accountId, entry))).then(
    () => {
      unsavedKeys.delete(entry.key);
      return true;
    },
    () => false,
  );
  return { claim, persisted };
}

/**
 * Call only when the completion decision (`cardSubmitCompletion`) says the
 * order is complete. It stops blocking in this process at once and for good
 * (`resolvedKeys`): no later read, account switch or stale load brings it
 * back here. The result says what storage did: "removed" or "tombstoned"
 * (either survives a relaunch), or "notSaved" (no store took the removal:
 * it is retried in this process, and after a relaunch before a successful
 * retry the marker blocks again, which fails closed).
 */
export function resolveUnresolvedCardResult(claim: CardResultClaim): Promise<"removed" | "tombstoned" | "notSaved"> {
  resolvedKeys.add(claim.key);
  const isResolved = (entry: UnresolvedCardResult) => entry.key === claim.key;
  recordedResults.set(claim.accountId, (recordedResults.get(claim.accountId) ?? []).filter((entry) => !isResolved(entry)));
  paymentAccount = { ...paymentAccount, stored: paymentAccount.stored.filter((entry) => !isResolved(entry)) };
  // Never written and no write pending: there is nothing durable to remove.
  // A write still queued skips itself (`addIfLive`); one already running may
  // still land, so the removal below is queued behind it.
  if (unsavedKeys.delete(claim.key) && !writesInFlight.has(claim.key)) return Promise.resolve("removed");
  const cleanups = pendingCleanups.get(claim.accountId) ?? new Set<string>();
  cleanups.add(claim.key);
  pendingCleanups.set(claim.accountId, cleanups);
  const current = resultStore;
  if (!current) return Promise.resolve("notSaved");
  return enqueueResult(() => current.remove(claim.accountId, claim.key)).then(
    (outcome) => {
      cleanups.delete(claim.key);
      return outcome;
    },
    (): "notSaved" => "notSaved",
  );
}

/** The mounted cart owner, read through its live session authority. A retired provider is never consulted. */
let liveCartOwner: { readSessionId: () => string | null } | null = null;

/**
 * Called by the mounted cart owner (`CartContext`). Returns the retirement:
 * once called (unmount), that provider's session no longer counts as live,
 * even if a screen still holds its context value.
 */
export function registerCartOwner(readSessionId: () => string | null): () => void {
  const owner = { readSessionId };
  liveCartOwner = owner;
  return () => {
    if (liveCartOwner === owner) liveCartOwner = null;
  };
}

/** The live cart owner's current session, or null when no owner is mounted. */
export function readLiveCartSession(): string | null {
  return liveCartOwner?.readSessionId() ?? null;
}

/**
 * What a card attempt is bound to: the cart session and the authentication
 * generation that opened the card form.
 */
export type CardAttemptBinding = Readonly<{ sessionId: string; isAuthenticationCurrent: () => boolean }>;

/** True only while the binding's session is the live owner's session and its authentication is current. */
export function isCardAttemptBindingLive(binding: CardAttemptBinding) {
  return readLiveCartSession() === binding.sessionId && binding.isAuthenticationCurrent();
}

/**
 * Locks the binding's session only while the binding is live. A callback
 * from an inactive screen, a retired provider or an earlier sign-in must not
 * replace a newer session's lock, attempt or persisted record; its
 * account-scoped marker already blocks payments.
 */
export function markPaymentOutcomeUnknownIfLive(binding: CardAttemptBinding, method: PaymentMethodKind) {
  if (!isCardAttemptBindingLive(binding)) return false;
  markPaymentOutcomeUnknown(binding.sessionId, method);
  return true;
}

/**
 * A card payment is active for this session: the card form is on screen (a
 * payment may complete in it at any moment) or its result is being
 * submitted. Returns the release. The cart owner defers its client-side
 * expiry teardown while this is held (`isCardFormOpen`), so the timer never
 * destroys the CyberSource form or an in-flight submit; the card screen
 * bounds the hold after expiry (`expiredCardFormAction`). The expiry notice
 * also reads it so it never says "no payment was taken".
 */
export function markCardFormOpen(sessionId: string): () => void {
  openCardForms.set(sessionId, (openCardForms.get(sessionId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (openCardForms.get(sessionId) ?? 1) - 1;
    if (count > 0) openCardForms.set(sessionId, count);
    else openCardForms.delete(sessionId);
  };
}

export function isCardFormOpen(sessionId: string | null) {
  return sessionId !== null && openCardForms.has(sessionId);
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
 * caller does not submit (nothing is sent by this attempt). An unresolved
 * card result of the current account blocks it, except `own`: the result
 * the card screen recorded and is about to submit.
 */
export function acquirePaymentAttempt(
  sessionId: string,
  method: PaymentMethodKind,
  own: CardResultClaim | null = null,
  /** Card: the attempt is refused unless this binding is live for `sessionId`. */
  binding: CardAttemptBinding | null = null,
): Promise<PaymentAttemptAcquisition> {
  if (binding && (binding.sessionId !== sessionId || !isCardAttemptBindingLive(binding))) {
    return Promise.resolve({ ok: false, reason: "blocked" });
  }
  // Method-aware: an account-scope card marker never blocks a BLUE attempt.
  if (readPaymentOutcomeLock(sessionId, own, method) || readPaymentAttempt(sessionId)) {
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
  // Session scope only: an account-level block never strands another attempt.
  if (sessionLock(sessionId)) return Promise.resolve();
  const held = readPaymentAttempt(sessionId);
  if (held && attemptId !== undefined && held.id !== attemptId) return Promise.resolve();
  if (held) attempt = null;
  const current = store;
  if (!current) return Promise.resolve();
  return enqueue(async () => {
    // A newer attempt (or a lock) for this session may have been acquired meanwhile.
    if (sessionLock(sessionId) || readPaymentAttempt(sessionId)) return;
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
  // It existed before this process: an unreadable marker store may hide one for it.
  if (sessionId !== null) restoredSessions.add(sessionId);
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
