import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createAuthenticationAuthority, requestAuthentication } from "./authSessionOwnership.ts";
import { cardResultReference, cardSubmitCompletion, cardSubmitOrderReference } from "./cardPaymentResult.ts";
import { expiredHoldFrom } from "./holdExpiry.ts";
import { en } from "../i18n/messages/en.ts";
import { ar } from "../i18n/messages/ar.ts";
import {
  CHUNK_LENGTH,
  MAX_RECORD_LENGTH,
  createChunkedSlots,
  createUnresolvedCardResultStore,
  createWebStorageBackend,
} from "./unresolvedCardResultStore.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const section = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing: ${end}`);
  return source.slice(from, to);
};
const asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** A fresh copy of the lock module = a new app process: memory is gone, only the injected stores survive. */
let processCount = 0;
async function newProcess() {
  processCount += 1;
  return import(`./paymentOutcomeLock.ts?process=${processCount}`);
}

/**
 * A key/value backend. `secure: true` mimics SecureStore: values over the
 * historical iOS ~2048-byte ceiling and keys outside [A-Za-z0-9._-] are
 * rejected. Reads, writes and removals can be made to fail.
 */
function disk({ secure = false } = {}) {
  const values = new Map();
  const state = { failSet: false, failGet: false, failRemove: false, failSetFor: null, failRemoveFor: null };
  return {
    values,
    state,
    dump: () => [...values.values()].join("\n"),
    backend: {
      get: async (key) => {
        if (state.failGet) throw new Error("read failed");
        return values.has(key) ? values.get(key) : null;
      },
      set: async (key, value) => {
        if (state.failSet || state.failSetFor?.(key)) throw new Error("write failed");
        if (secure && !/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`invalid key ${key}`);
        if (secure && Buffer.byteLength(value, "utf8") > 2048) throw new Error("value too large");
        values.set(key, value);
      },
      remove: async (key) => {
        if (state.failRemove || state.failRemoveFor?.(key)) throw new Error("remove failed");
        values.delete(key);
      },
    },
  };
}

/** The existing session-scoped lock record (AsyncStorage in the app). */
function sessionDisk() {
  let value = null;
  return { get: async () => value, set: async (next) => { value = next; }, remove: async () => { value = null; }, peek: () => value };
}

function devices() {
  return { primary: disk({ secure: true }), ledger: disk(), session: sessionDisk() };
}

async function boot(device = devices()) {
  const lock = await newProcess();
  lock.configurePaymentOutcomeStore(device.session);
  lock.configureUnresolvedCardResultStore(createUnresolvedCardResultStore({ primary: device.primary.backend, ledger: device.ledger.backend }));
  return { lock, device };
}

const storeOf = (device) => createUnresolvedCardResultStore({ primary: device.primary.backend, ledger: device.ledger.backend });
const storedMarkers = async (device, account = "7") => (await storeOf(device).read(account)).markers;

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", kid: "k1" })}.${part(claims)}.${"s".repeat(342)}`;
}

/** Shaped like CyberSource's documented authorization response. */
function paymentResult({ id = "7533511014286971803092", status = "AUTHORIZED" } = {}) {
  return jwt({ id, status, outcome: status, details: { orderInformation: { amountDetails: { totalAmount: "21.00", currency: "USD" } }, extra: "x".repeat(2600) } });
}

/** A record as the first version wrote it: raw JWT, billing details and holder names. */
function legacyRecord(result = paymentResult()) {
  return {
    version: 1,
    accountId: "7",
    results: [{
      key: "legacy-1",
      accountId: "7",
      sessionId: "S0",
      recordedAt: 1730000000000,
      result,
      reference: "7533511014286971803092",
      context: { checkout_session_id: "S0", billing: { name: "سارة خليل", phone: "96171123456", country: "LB" }, tickets_by_match: { 17: [{ holder_name: "سارة خليل" }] }, payment_method: "cybersource" },
    }],
  };
}

function record(lock, { accountId = "7", sessionId = "S1", result = paymentResult() } = {}) {
  return lock.recordUnresolvedCardResult({ accountId, sessionId, result, reference: cardResultReference(result) });
}

// ── Regression: retired providers and late callbacks overwrote a newer session's lock ──

const liveAuth = () => true;
const staleAuth = () => false;

test("regression: a retired cart provider's late card callback never acquires or locks over the newer session", async () => {
  const device = devices();
  const { lock } = await boot(device);
  // Provider P1 owned S1 and was retired (remounted); P2 owns S2, whose attempt is held and recorded.
  const retireP1 = lock.registerCartOwner(() => "S1");
  retireP1();
  lock.registerCartOwner(() => "S2");
  const newer = await lock.acquirePaymentAttempt("S2", "blue");
  assert.equal(newer.ok, true);

  // The S1 screen still holds P1's context, which would still call S1 current.
  const late = { sessionId: "S1", isAuthenticationCurrent: liveAuth };
  assert.equal(lock.readLiveCartSession(), "S2");
  assert.equal(lock.isCardAttemptBindingLive(late), false);
  assert.equal(lock.markPaymentOutcomeUnknownIfLive(late, "card"), false);
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "card", null, late), { ok: false, reason: "blocked" });
  assert.equal(lock.readPaymentAttempt("S2")?.id, newer.attempt.id, "the newer attempt is intact");
  await lock.settlePaymentAttempt("__flush__");
  assert.equal(JSON.parse(device.session.peek()).sessionId, "S2", "the newer persisted record is intact");
  const relaunched = await boot(device);
  await relaunched.lock.restorePaymentOutcomeLock("S2");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2")?.sessionId, "S2");

  // No provider mounted: nothing is live.
  const empty = await boot(devices());
  assert.equal(empty.lock.markPaymentOutcomeUnknownIfLive({ sessionId: "S1", isAuthenticationCurrent: liveAuth }, "card"), false);

  // The unguarded call is what overwrote it.
  const unguarded = await boot(devices());
  await unguarded.lock.acquirePaymentAttempt("S2", "blue");
  unguarded.lock.markPaymentOutcomeUnknown("S1", "card");
  await unguarded.lock.settlePaymentAttempt("__flush__");
  assert.equal(JSON.parse(unguarded.device.session.peek()).sessionId, "S1", "hazard: S2's record replaced");
});

test("regression: an attempt from an earlier sign-in never acquires or locks, even on the live session", async () => {
  const { lock } = await boot();
  lock.registerCartOwner(() => "S1");
  const earlierSignIn = { sessionId: "S1", isAuthenticationCurrent: staleAuth };
  assert.deepEqual(await lock.acquirePaymentAttempt("S1", "card", null, earlierSignIn), { ok: false, reason: "blocked" });
  assert.equal(lock.markPaymentOutcomeUnknownIfLive(earlierSignIn, "card"), false);
  assert.equal(lock.readPaymentOutcomeLock("S1"), null);
  assert.deepEqual(
    await lock.acquirePaymentAttempt("S9", "card", null, { sessionId: "S1", isAuthenticationCurrent: liveAuth }),
    { ok: false, reason: "blocked" },
    "a binding for another session never acquires this one",
  );
  const live = { sessionId: "S1", isAuthenticationCurrent: liveAuth };
  assert.equal((await lock.acquirePaymentAttempt("S1", "card", null, live)).ok, true);
  assert.equal(lock.markPaymentOutcomeUnknownIfLive(live, "card"), true);
  assert.equal(lock.readPaymentOutcomeLock("S1")?.sessionId, "S1");
});

test("card screen: every acquisition and session-lock write goes through the live binding; the submit is pinned to the opening authentication", async () => {
  const card = strip(await read("../components/CardPaymentScreen.tsx"));
  const handle = section(card, "const handleSuccess = useCallback(", "} finally {");
  assert.match(handle, /accountId: handoff\?\.accountId \?\? null,\s*sessionId: handoff\?\.sessionId \?\? null,/);
  assert.doesNotMatch(card, /markPaymentOutcomeUnknown\(|markPaymentOutcomeUnknownIfCurrent/);
  assert.match(handle, /isAuthenticationCurrent: \(\) => isAuthenticationSnapshotCurrent\(snapshot\) && signedInAccountRef\.current === handoff\.accountId,/);
  assert.match(handle, /await acquirePaymentAttempt\(sessionId, "card", claim, binding\)/);
  assert.equal((handle.match(/acquirePaymentAttempt\(/g) ?? []).length, 1);
  const finalGuard = section(handle, "const blockedBeforeSubmit = submitBlock(sessionId, attempt, claim)", "await checkoutService.submit(");
  assert.match(finalGuard, /isCardAttemptBindingLive\(binding\)/);
  assert.doesNotMatch(finalGuard, /await /, "nothing awaits between the final guard and the submit");
  assert.match(handle, /\{ authentication: snapshot \}/);
  assert.match(card, /const sameAccount = handoff\.accountId !== null && signedInAccountRef\.current === handoff\.accountId;/);
  const context = strip(await read("../context/CartContext.tsx"));
  assert.match(context, /useEffect\(\(\) => registerCartOwner\(\(\) => sessionAuthorityRef\.current\.currentSessionId\(\)\), \[\]\);/);
  const service = strip(await read("../services/checkout.ts"));
  assert.match(service, /authenticationSnapshot: options\.authentication/);
});

// ── Regression: a 401/403 for account A's request ended account B's session ──

test("regression: a 401/403 can only end the authentication whose token was actually sent", async () => {
  const authority = createAuthenticationAuthority();
  const accountA = authority.replace("token-A");
  const sent = requestAuthentication({ live: accountA, pinned: accountA, hasOverride: false, isCurrent: authority.isCurrent });
  assert.deepEqual(sent, { token: "token-A", invalidates: accountA, stale: false });
  // Account B signs in while A's request is in flight; A's 401 arrives afterwards.
  const accountB = authority.replace("token-B");
  assert.equal(authority.claim(sent.invalidates), null, "A's 401 cannot claim B's generation");
  assert.equal(authority.isCurrent(accountB), true, "B's session survives");

  // The request's live capture is already B's while A's token is pinned: attributed to A, and never sent.
  const raced = requestAuthentication({ live: accountB, pinned: accountA, hasOverride: false, isCurrent: authority.isCurrent });
  assert.equal(raced.stale, true);
  assert.equal(raced.invalidates, accountA);
  // A bare override token cannot be attributed: it invalidates nothing. The default uses the live snapshot.
  assert.equal(requestAuthentication({ live: accountB, hasOverride: true, override: "token-A", isCurrent: authority.isCurrent }).invalidates, null);
  assert.equal(requestAuthentication({ live: accountB, hasOverride: false, isCurrent: authority.isCurrent }).invalidates, accountB);

  const api = strip(await read("../services/api.ts"));
  assert.ok(api.indexOf("if (stale) throw new StaleAuthenticationError();") > 0);
  assert.ok(api.indexOf("if (stale) throw new StaleAuthenticationError();") < api.indexOf("await fetch(url"), "refused before sending");
  assert.match(api, /invalidates && \(response\.status === 401 \|\| response\.status === 403\)\) \{\s*await invalidateAuthentication\(invalidates\);/);
  assert.doesNotMatch(api, /invalidateAuthentication\(authentication\)/);
});

// ── Regression: marker ids collided across tabs; a stale load revived a resolved block ──

test("regression: two tabs recording in the same millisecond keep two markers; the same result is one", async () => {
  const shared = devices();
  const tabA = await boot(shared);
  const tabB = await boot(shared);
  await tabA.lock.selectPaymentAccount("7");
  await tabB.lock.selectPaymentAccount("7");
  const realNow = Date.now;
  Date.now = () => 1767225600000;
  try {
    const a = record(tabA.lock, { result: paymentResult({ id: "1000000000000000000001" }) });
    const b = record(tabB.lock, { result: paymentResult({ id: "1000000000000000000002" }) });
    assert.notEqual(a.claim.key, b.claim.key);
    assert.deepEqual(await Promise.all([a.persisted, b.persisted]), [true, true]);
    const same = paymentResult({ id: "1000000000000000000003" });
    const c = record(tabA.lock, { result: same });
    const d = record(tabB.lock, { result: same });
    assert.equal(c.claim.key, d.claim.key, "one payment result, one key, in any tab");
    await Promise.all([c.persisted, d.persisted]);
  } finally {
    Date.now = realNow;
  }
  assert.equal((await storedMarkers(shared)).length, 3, "no tab's write was lost");
});

test("regression: after cleanup succeeds, a stale load or an account switch never brings the block back", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const { claim, persisted } = record(lock);
  await persisted;
  await lock.selectPaymentAccount("8");
  const staleLoad = lock.selectPaymentAccount("7"); // reads storage before the cleanup runs
  assert.equal(await lock.resolveUnresolvedCardResult(claim), "removed");
  await staleLoad;
  assert.equal(lock.readPaymentOutcomeLock("S2"), null, "the stale load did not revive it");
  await lock.selectPaymentAccount("8");
  await lock.selectPaymentAccount("7");
  assert.equal(lock.readPaymentOutcomeLock("S2"), null);
  assert.deepEqual(lock.readUnresolvedCardResults(), []);
  assert.deepEqual(await storedMarkers(device), []);
  // A late repeat of the resolved result is not recorded again.
  assert.equal(await record(lock).persisted, true);
  assert.equal(lock.readPaymentOutcomeLock("S2"), null);
  assert.deepEqual(await storedMarkers(device), []);
});

test("regression: legacy chunks holding the JWT and personal details are retried until deleted", async () => {
  const device = devices();
  const result = paymentResult();
  await createChunkedSlots(device.primary.backend).write("7", asciiJson(legacyRecord(result)));
  const legacyChunks = [...device.primary.values.keys()].filter((key) => key.split(".").length === 4);
  device.primary.state.failRemoveFor = (key) => legacyChunks.includes(key);
  device.primary.state.failSetFor = (key) => key.endsWith(".gc"); // even the retry list cannot be saved at first

  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  assert.equal(lock.readPaymentOutcomeLock("S9")?.scope, "account");
  assert.match(device.primary.dump(), /billing/, "the old chunks are still on disk");

  // Kept in memory and retried in this process: now the retry list is saved.
  device.primary.state.failSetFor = null;
  await lock.selectPaymentAccount("7");
  assert.equal((await createChunkedSlots(device.primary.backend).pendingGarbage("7")).length, 1, "persisted for a relaunch");

  // A relaunch retries from the persisted list; once removal works, they are gone.
  device.primary.state.failRemoveFor = null;
  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  const after = device.primary.dump();
  assert.doesNotMatch(after, /billing|holder_name|\\u0633/);
  assert.equal(after.includes(result.split(".")[1]), false, "no JWT left");
  assert.deepEqual(await createChunkedSlots(device.primary.backend).pendingGarbage("7"), []);
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S9")?.scope, "account", "the marker still blocks");
});


// ── Regression 2: a memory-only fallback was reported as saved ─────────────

test("regression: on web, unavailable localStorage is a failed save, never a memory-only 'saved'", async () => {
  for (const unavailable of [() => null, () => undefined, () => { throw new Error("SecurityError"); }]) {
    const web = createWebStorageBackend(() => {
      try {
        return unavailable();
      } catch {
        return null;
      }
    });
    const lock = await newProcess();
    lock.configureUnresolvedCardResultStore(createUnresolvedCardResultStore({ primary: web, ledger: web }));
    await lock.selectPaymentAccount("7");
    assert.equal(lock.readPaymentOutcomeLock("S1")?.scope, "account", "an unreadable store fails closed");
    const { persisted } = record(lock);
    assert.equal(await persisted, false);
  }
  // A throwing localStorage (quota, private mode) is a failed save too.
  const throwing = createWebStorageBackend(() => ({
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => {},
  }));
  const lock = await newProcess();
  lock.configureUnresolvedCardResultStore(createUnresolvedCardResultStore({ primary: throwing, ledger: throwing }));
  await lock.selectPaymentAccount("7");
  assert.equal(await record(lock).persisted, false);
  // The web adapter does not use the app storage adapter, which falls back to memory.
  const webAdapter = strip(await read("./unresolvedCardResultStorage.ts"));
  assert.doesNotMatch(webAdapter, /@\/lib\/storage"/);
  assert.match(webAdapter, /createWebStorageBackend\(/);
});

// ── Persistence: writes, relaunch after each outcome ───────────────────────

test("a saved marker blocks the account at once and after a relaunch, on every session", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const { persisted } = record(lock);
  // Its own checkout session: every method (that checkout may already be paid).
  assert.deepEqual(lock.readPaymentOutcomeLock("S1"), { sessionId: "S1", method: "card" });
  assert.deepEqual(lock.readPaymentOutcomeLock("S1", null, "blue"), { sessionId: "S1", method: "card" });
  // Another session: card only.
  assert.deepEqual(lock.readPaymentOutcomeLock("S9"), { sessionId: "S9", method: "card", scope: "account" });
  assert.equal(await persisted, true);

  const relaunched = await boot(device);
  const loading = relaunched.lock.selectPaymentAccount("7");
  // While reading, a marker for this very session cannot be ruled out: every method waits (briefly).
  assert.notEqual(relaunched.lock.readPaymentOutcomeLock("S2"), null, "fail closed while reading");
  assert.notEqual(relaunched.lock.readPaymentOutcomeLock("S2", null, "blue"), null, "BLUE waits for the read too");
  await loading;
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2", null, "blue"), null, "then BLUE on another session is free");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2")?.scope, "account");
  assert.deepEqual(await relaunched.lock.acquirePaymentAttempt("S2", "card"), { ok: false, reason: "blocked" });
  const [marker] = relaunched.lock.readUnresolvedCardResults();
  assert.equal(marker.sessionId, "S1");
  assert.equal(marker.reference, "7533511014286971803092");
});

test("failed primary write: the ledger keeps it durable, a relaunch still blocks, and it is folded back later", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  device.primary.state.failSet = true;
  assert.equal(await record(lock).persisted, true, "durable in the ledger");
  assert.equal(device.primary.values.size, 0);

  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2")?.scope, "account");

  device.primary.state.failSet = false;
  const recovered = await boot(device);
  await recovered.lock.selectPaymentAccount("7");
  assert.ok(device.primary.values.size > 0, "compacted into the primary");
  assert.equal(device.ledger.values.size, 0, "ledger cleared");
  assert.equal((await storedMarkers(device)).length, 1);
});

test("failed writes everywhere: reported as not saved; retried in-process; a relaunch before a retry cannot see it", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  device.primary.state.failSet = true;
  device.ledger.state.failSet = true;
  assert.equal(await record(lock).persisted, false);
  assert.deepEqual(lock.readPaymentOutcomeLock("S1"), { sessionId: "S1", method: "card" }, "still blocks its session in this process");
  assert.equal(lock.readPaymentOutcomeLock("S2")?.scope, "account", "and card on other sessions");

  // Relaunch before any retry succeeded: nothing durable exists (the user was told "not saved").
  const early = await boot(device);
  await early.lock.selectPaymentAccount("7");
  assert.equal(early.lock.readPaymentOutcomeLock("S2"), null);

  // Storage recovers; the next account selection (checkout focus) retries the write.
  device.primary.state.failSet = false;
  device.ledger.state.failSet = false;
  await lock.selectPaymentAccount("7");
  const late = await boot(device);
  await late.lock.selectPaymentAccount("7");
  assert.equal(late.lock.readPaymentOutcomeLock("S2")?.scope, "account", "durable after the retry");
});

// ── Persistence: removals, relaunch after each outcome ─────────────────────

test("failed primary removal: tombstoned in the ledger, so a relaunch never revives a resolved result", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const { claim, persisted } = record(lock);
  await persisted;
  device.primary.state.failSet = true;
  device.primary.state.failRemove = true;
  assert.equal(await lock.resolveUnresolvedCardResult(claim), "tombstoned");
  assert.equal(lock.readPaymentOutcomeLock("S2"), null);

  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S2"), null, "the confirmed order stays resolved");

  device.primary.state.failSet = false;
  device.primary.state.failRemove = false;
  const recovered = await boot(device);
  await recovered.lock.selectPaymentAccount("7");
  assert.equal(device.primary.values.size, 0, "compaction removed it from the primary");
  assert.equal(device.ledger.values.size, 0, "and cleared the tombstone");
});

test("failed removal everywhere: reported, never blocks this process, retried; fails closed only if relaunched first", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const { claim, persisted } = record(lock);
  await persisted;
  device.primary.state.failSet = true;
  device.primary.state.failRemove = true;
  device.ledger.state.failSet = true;
  assert.equal(await lock.resolveUnresolvedCardResult(claim), "notSaved");
  assert.equal(lock.readPaymentOutcomeLock("S2"), null, "resolved in this process");
  await lock.selectPaymentAccount("8");
  await lock.selectPaymentAccount("7");
  assert.equal(lock.readPaymentOutcomeLock("S2"), null, "reloading the account does not revive it in this process");

  // Relaunch before a retry: the marker is still on disk, so it blocks (fail closed, documented).
  const early = await boot(device);
  await early.lock.selectPaymentAccount("7");
  assert.equal(early.lock.readPaymentOutcomeLock("S2")?.scope, "account");

  // Storage recovers; the retry removes it; a later relaunch is clear.
  device.primary.state.failSet = false;
  device.primary.state.failRemove = false;
  device.ledger.state.failSet = false;
  await lock.selectPaymentAccount("7");
  const late = await boot(device);
  await late.lock.selectPaymentAccount("7");
  assert.equal(late.lock.readPaymentOutcomeLock("S2"), null);
});

test("a marker resolved before its queued write runs is never written", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  device.primary.state.failSet = true;
  device.ledger.state.failSet = true;
  const { claim, persisted } = record(lock);
  assert.equal(await persisted, false);
  assert.equal(await lock.resolveUnresolvedCardResult(claim), "removed", "nothing durable existed");
  device.primary.state.failSet = false;
  device.ledger.state.failSet = false;
  await lock.selectPaymentAccount("7");
  assert.equal(device.primary.values.size + device.ledger.values.size, 0);
});

// ── Data minimization and format migration ─────────────────────────────────

test("only a marker is persisted: no payment JWT, billing details or holder names", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const result = paymentResult();
  await record(lock, { result }).persisted;
  device.primary.state.failSet = true;
  await record(lock, { result: paymentResult({ id: "1111111111111111111111" }) }).persisted; // lands in the ledger
  const everything = device.primary.dump() + device.ledger.dump();
  assert.doesNotMatch(everything, /eyJ|transient_token|billing|holder_name|96171123456|سارة/);
  assert.equal(everything.includes(result.split(".")[1]), false);
  const [marker] = await storedMarkers(device);
  assert.deepEqual(Object.keys(marker).sort(), ["accountId", "key", "recordedAt", "reference", "sessionId"]);
});

test("version-1 records (raw JWT and checkout context) are preserved as blocking, then rewritten as markers", async () => {
  const device = devices();
  const result = paymentResult();
  const legacy = {
    version: 1,
    accountId: "7",
    results: [{
      key: "legacy-1",
      accountId: "7",
      sessionId: "S0",
      recordedAt: 1730000000000,
      result,
      reference: "7533511014286971803092",
      context: { checkout_session_id: "S0", billing: { name: "سارة خليل", phone: "96171123456", country: "LB" }, tickets_by_match: { 17: [{ holder_name: "سارة خليل" }] }, payment_method: "cybersource" },
    }],
  };
  await createChunkedSlots(device.primary.backend).write("7", asciiJson(legacy));
  assert.match(device.primary.dump(), /billing/);

  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  assert.equal(lock.readPaymentOutcomeLock("S9")?.scope, "account", "the old record still blocks");
  const after = device.primary.dump();
  assert.doesNotMatch(after, /billing|holder_name|transient|\\u0633/);
  assert.equal(after.includes(result.split(".")[1]), false, "JWT removed");
  const [marker] = await storedMarkers(device);
  assert.deepEqual(marker, { key: "legacy-1", accountId: "7", sessionId: "S0", recordedAt: 1730000000000, reference: "7533511014286971803092" });

  // If the rewrite fails, the legacy record stays and keeps blocking.
  const stuck = devices();
  await createChunkedSlots(stuck.primary.backend).write("7", asciiJson(legacy));
  stuck.primary.state.failSet = true;
  const other = await boot(stuck);
  await other.lock.selectPaymentAccount("7");
  assert.equal(other.lock.readPaymentOutcomeLock("S9")?.scope, "account");
  assert.match(stuck.primary.dump(), /billing/, "unchanged until a rewrite succeeds");
});

test("chunked values stay under the SecureStore ceiling, and incomplete or unreadable records fail closed", async () => {
  const device = devices();
  const slots = createChunkedSlots(device.primary.backend);
  const long = "a".repeat(CHUNK_LENGTH * 3 + 7);
  await slots.write("7", long);
  for (const value of device.primary.values.values()) assert.ok(Buffer.byteLength(value, "utf8") <= 2048);
  assert.equal(await slots.read("7"), long);
  await assert.rejects(slots.write("7", "x".repeat(MAX_RECORD_LENGTH + 1)));

  // Many markers in one account: still chunked under the ceiling.
  const { lock } = await boot(device);
  await slots.remove("7");
  await lock.selectPaymentAccount("7");
  for (let index = 0; index < 40; index += 1) await record(lock, { result: paymentResult({ id: `9${String(index).padStart(21, "0")}` }) }).persisted;
  for (const value of device.primary.values.values()) assert.ok(Buffer.byteLength(value, "utf8") <= 2048);
  assert.equal((await storedMarkers(device)).length, 40);

  // Lose one chunk: unreadable → blocked, and never overwritten.
  const chunkKey = [...device.primary.values.keys()].find((key) => key.split(".").length === 4);
  device.primary.values.delete(chunkKey);
  const snapshot = new Map(device.primary.values);
  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("7");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S5")?.scope, "account");
  await record(relaunched.lock, { result: paymentResult({ id: "9999999999999999999999" }) }).persisted;
  assert.deepEqual(new Map(device.primary.values), snapshot, "the damaged primary was not clobbered (the new marker went to the ledger)");

  // A read error fails closed, and a later selection retries it.
  const flaky = devices();
  flaky.primary.state.failGet = true;
  const third = await boot(flaky);
  await third.lock.selectPaymentAccount("7");
  assert.equal(third.lock.readPaymentOutcomeLock("S5")?.scope, "account");
  flaky.primary.state.failGet = false;
  await third.lock.selectPaymentAccount("7");
  assert.equal(third.lock.readPaymentOutcomeLock("S5"), null);
});

// ── Account, session and duplicate rules (unchanged from Step 1) ───────────

test("account switching: bound to the originating account, never applied to or shown to another", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  await record(lock).persisted;
  await lock.selectPaymentAccount("8");
  assert.equal(lock.readPaymentOutcomeLock("S3"), null);
  assert.deepEqual(lock.readUnresolvedCardResults(), []);
  await lock.selectPaymentAccount(null);
  await lock.selectPaymentAccount("7");
  assert.equal(lock.readPaymentOutcomeLock("S3")?.scope, "account", "sign-out did not delete it");
  // A slot naming another account is rejected (fails closed).
  const [marker] = await storedMarkers(device);
  await createChunkedSlots(device.primary.backend).write("8", JSON.stringify({ version: 2, accountId: "8", results: [marker] }));
  await assert.rejects(storeOf(device).read("8"));
  // Adding another account's marker is refused too (its read-back is unreadable).
  await assert.rejects(storeOf(device).add("9", marker));
});

test("missing checkout context: an unbound marker blocks every account and shows to none", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const { claim, persisted } = record(lock, { accountId: null, sessionId: null });
  assert.equal(claim.accountId, "unbound");
  assert.equal(claim.sessionId, "unknown");
  assert.equal(await persisted, true);
  assert.equal(lock.readPaymentOutcomeLock("S1")?.scope, "account");
  assert.deepEqual(lock.readUnresolvedCardResults(), []);
  const relaunched = await boot(device);
  await relaunched.lock.selectPaymentAccount("9");
  assert.equal(relaunched.lock.readPaymentOutcomeLock("S3")?.scope, "account");
});

test("a new cart session never releases it for card; BLUE on the new session stays available", async () => {
  const { lock } = await boot();
  await lock.selectPaymentAccount("7");
  record(lock, { sessionId: "S1" });
  await lock.discardPaymentOutcomeUnlessSession("S2");
  await lock.restorePaymentOutcomeLock("S2");
  assert.equal(lock.readPaymentOutcomeLock("S2")?.scope, "account");
  assert.deepEqual(await lock.acquirePaymentAttempt("S2", "card"), { ok: false, reason: "blocked" });
  assert.equal(lock.readPaymentOutcomeLock("S2", null, "blue"), null);
  assert.equal((await lock.acquirePaymentAttempt("S2", "blue")).ok, true, "an unrelated BLUE checkout is not blocked");
});

test("duplicate callbacks are one record; the recorder's own result passes its gate, another never does", async () => {
  const device = devices();
  const { lock } = await boot(device);
  await lock.selectPaymentAccount("7");
  const result = paymentResult();
  const a = record(lock, { result });
  const b = record(lock, { result });
  assert.equal(a.claim.key, b.claim.key);
  await Promise.all([a.persisted, b.persisted]);
  assert.equal((await storedMarkers(device)).length, 1);
  assert.equal(lock.readPaymentOutcomeLock("S1", a.claim), null);
  const other = record(lock, { result: paymentResult({ id: "2222222222222222222222" }) });
  await other.persisted;
  // The other result was recorded for S1 too: it blocks S1 for every method, even for a's recorder.
  assert.deepEqual(lock.readPaymentOutcomeLock("S1", a.claim), { sessionId: "S1", method: "card" });
  assert.equal(await lock.resolveUnresolvedCardResult(a.claim), "removed");
  assert.equal(lock.readPaymentOutcomeLock("S4")?.scope, "account", "the other still blocks");
});

test("an account-level block never strands another method's attempt", async () => {
  const { lock } = await boot();
  await lock.selectPaymentAccount("7");
  const blue = await lock.acquirePaymentAttempt("S1", "blue");
  record(lock, { sessionId: "S0" });
  await lock.settlePaymentAttempt("S1", blue.attempt.id);
  assert.equal(lock.readPaymentAttempt("S1"), null);
  assert.equal(lock.readPaymentOutcomeLock("S1")?.scope, "account");
});

// ── Response contract ──────────────────────────────────────────────────────

test("one conservative completion decision: only a 2xx proving a paid order completes; everything else is unresolved, not failed", async () => {
  // The confirmed completed-order shape (an order named, order status paid).
  const completed = {
    success: true,
    order_id: "123",
    order_number: "ORD-123",
    status: "paid",
    total: 50,
    currency: "USD",
    payment: { provider: "cybersource", reference: "payment-ref" },
  };
  assert.equal(cardSubmitCompletion(completed), "complete");
  assert.equal(cardSubmitCompletion({ order_id: 1105, status: "paid" }), "complete", "numeric id (staging order 1105)");
  assert.equal(cardSubmitCompletion({ order_number: "ORD-9", status: " PAID " }), "complete", "status compared trimmed, case-insensitive");
  assert.equal(cardSubmitCompletion({ ...completed, payment: { status: "AUTHORIZED" } }), "complete", "a payment status that does not contradict it");

  // Not proof: an object with no order or no paid status.
  for (const object of [{}, { success: true }, { order_id: "1" }, { status: "paid" }, { success: true, status: "paid" }]) {
    assert.equal(cardSubmitCompletion(object), "unresolved", JSON.stringify(object));
  }
  // An explicit or malformed success flag.
  for (const flag of [false, "true", 1, null]) {
    assert.equal(cardSubmitCompletion({ ...completed, success: flag }), "unresolved", "success: " + JSON.stringify(flag));
  }
  // Declined, pending, failed and unknown order statuses.
  for (const status of ["DECLINED", "PENDING", "pending_payment", "failed", "cancelled", "expired", "completed", "", 1]) {
    assert.equal(cardSubmitCompletion({ ...completed, status }), "unresolved", "status: " + JSON.stringify(status));
  }
  // Payment statuses that contradict a paid order.
  for (const status of ["DECLINED", "PENDING", "AUTHORIZED_PENDING_REVIEW", "AUTHORIZED_RISK_DECLINED", "INVALID_REQUEST", "voided", 3]) {
    assert.equal(cardSubmitCompletion({ ...completed, payment: { status } }), "unresolved", "payment.status: " + JSON.stringify(status));
  }
  // Malformed payment and order fields.
  for (const payment of ["paid", 1, true, [], [{ status: "paid" }]]) {
    assert.equal(cardSubmitCompletion({ ...completed, payment }), "unresolved", "payment: " + JSON.stringify(payment));
  }
  for (const order of [{ order_id: "" }, { order_id: "  " }, { order_id: 0 }, { order_id: -4 }, { order_id: 1.5 }, { order_id: {} }, { order_id: "1; DROP" }, { order_number: [] }]) {
    assert.equal(cardSubmitCompletion({ status: "paid", ...order }), "unresolved", "order: " + JSON.stringify(order));
  }
  // A redirect means the provider still needs the payer.
  assert.equal(cardSubmitCompletion({ ...completed, payment: { payment_url: "https://pay.example.test/payment/abc" } }), "unresolved");
  // Empty body, non-JSON body (apiRequest yields null for both), JSON null, bare values, arrays.
  for (const unparsed of [null, undefined, "", "<html>Bad gateway</html>", "ok", 1, true, [], [{ success: true }]]) {
    assert.equal(cardSubmitCompletion(unparsed), "unresolved", JSON.stringify(unparsed));
  }
  // A named order is kept for display, unverified, and decides nothing.
  assert.equal(cardSubmitOrderReference({ order_id: 77, order_number: "ORD-77", status: "pending" }), "ORD-77");
  assert.equal(cardSubmitOrderReference({ order_id: 77 }), "77");
  assert.equal(cardSubmitOrderReference({ order_id: "<b>" }), null);
  assert.equal(cardSubmitOrderReference(null), null);

  // The real runtime path: apiRequest turns an empty or non-JSON 2xx body into null.
  const api = await read("../services/api.ts");
  assert.match(api, /\.json\(\)\.catch\(\(\) => null\)/);

  // The decision releases or keeps the marker accordingly (the screen's two branches).
  const { lock } = await boot();
  await lock.selectPaymentAccount("7");
  const done = record(lock, { result: paymentResult({ id: "5000000000000000000001" }) });
  await done.persisted;
  assert.equal(cardSubmitCompletion({ order_id: "1", status: "paid" }), "complete");
  assert.equal(await lock.resolveUnresolvedCardResult(done.claim), "removed");
  const pending = record(lock, { result: paymentResult({ id: "5000000000000000000002" }) });
  await pending.persisted;
  assert.equal(cardSubmitCompletion({ payment: { payment_url: "https://pay.example.test/payment/x" } }), "unresolved");
  assert.equal(lock.readPaymentOutcomeLock("S8", pending.claim), null, "only the pending one remains, as its recorder's own");
  assert.equal(lock.readPaymentOutcomeLock("S8")?.scope, "account", "the pending result keeps blocking");

  const card = strip(await read("../components/CardPaymentScreen.tsx"));
  assert.equal(card.split("cardSubmitCompletion(").length - 1, 1, "one decision on the card screen");
  assert.doesNotMatch(card, /submitResponseIdentifiesOrder/);
  const handle = section(card, "const handleSuccess = useCallback(", "} finally {");
  assert.equal(handle.split("resolveUnresolvedCardResult(").length - 1, 1, "one resolve call");
  const failurePath = section(handle, "} catch (submissionError) {", "if (!activeRef.current) return;");
  assert.doesNotMatch(failurePath, /status|paymentFailureKind|ApiError|settlePaymentAttempt|resolveUnresolvedCardResult/);
});


// ── Expiry and copy ────────────────────────────────────────────────────────

test("expiry during payment: an open card form makes the expiry notice uncertain", async () => {
  const { lock } = await boot();
  const release = lock.markCardFormOpen("S1");
  assert.equal(expiredHoldFrom([{ match_id: 17 }], lock.isCardFormOpen("S1")).paymentTouched, true);
  release();
  release();
  assert.equal(lock.isCardFormOpen("S1"), false);
  const context = strip(await read("../context/CartContext.tsx"));
  const snapshot = section(context, "const snapshot = expiredHoldFrom(", "const cleared = await clearCartSessionIfCurrent(");
  assert.match(snapshot, /\|\| isCardFormOpen\(expected\.sessionId\)/);
  const card = strip(await read("../components/CardPaymentScreen.tsx"));
  assert.match(card, /return markCardFormOpen\(formSessionId\);/);
  assert.doesNotMatch(en["holdExpired.messagePayment"], /No payment was taken|extended|still held/i);
});

test("copy expresses uncertainty in both catalogs and never confirms a charge", () => {
  const keys = [
    "payment.card.unresolved.title",
    "payment.card.unresolved.message",
    "payment.card.unresolved.notSubmitted",
    "payment.card.unresolved.reference",
    "payment.card.unresolved.notSaved",
    "payment.card.unresolved.notRecorded",
    "payment.card.unresolved.otherPending",
    "checkout.paymentUnknown.accountMessage",
  ];
  for (const key of keys) {
    assert.ok(en[key] && ar[key], key);
    assert.doesNotMatch(en[key], /charge confirmed|payment received|was charged|nothing was (sent|charged)|no payment was taken/i, key);
  }
  assert.match(en["payment.card.unresolved.message"], /may have been charged/);
});
