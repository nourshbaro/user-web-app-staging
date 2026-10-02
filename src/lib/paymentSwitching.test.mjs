import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";
import {
  clearPendingBluePaymentAttempt,
  readPendingBluePaymentAttempt,
  savePendingBluePaymentAttempt,
} from "./bluePaymentHandoff.ts";
import { blueSuccessCompletion, checkoutAttemptBlocks, submissionGuard } from "./checkoutFlow.ts";
import { homeAvatar } from "./homeAvatar.ts";
import {
  acquirePaymentAttempt,
  clearPaymentOutcomeLockUnlessSession,
  configurePaymentOutcomeStore,
  isPaymentAttemptHeldByOther,
  markPaymentOutcomeUnknown,
  parkPaymentAttempt,
  readPaymentAttempt,
  readPaymentOutcomeLock,
  readParkedPaymentAttempt,
  restorePaymentOutcomeLock,
  settlePaymentAttempt,
} from "./paymentOutcomeLock.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Persisted storage that outlives the "process" (the module's memory). */
function disk() {
  let value = null;
  return {
    read: () => (value === null ? null : JSON.parse(value)),
    store: {
      get: async () => value,
      set: async (next) => { value = next; },
      remove: async () => { value = null; },
    },
  };
}

/** Checkout's Pay decision for a method, exactly as handleContinue reads the shared gate. */
function checkoutAllows(sessionId, paymentMethod) {
  const blocked = checkoutAttemptBlocks({
    heldMethod: readPaymentAttempt(sessionId)?.method ?? null,
    paymentMethod,
    hasReusableBlueAttempt: readPendingBluePaymentAttempt(sessionId) !== null,
  });
  const guard = submissionGuard({
    renderedSessionId: sessionId,
    owner: {
      sessionId,
      itemCount: 1,
      expired: false,
      reconciliationRequired: false,
      paymentOutcomeUnknown: readPaymentOutcomeLock(sessionId) !== null,
      paymentAttemptInProgress: blocked,
    },
    inFlight: false,
    holdersComplete: true,
    paymentMethod,
    profileComplete: true,
    phoneValid: true,
  });
  return guard.ok;
}

const BLUE_URL = "https://blue.example/payment/order-a";

/** "Continue with BLUE": acquire, the backend creates BLUE order A, its URL is stored, the page opens. */
async function sendBlueRequest(sessionId) {
  const acquisition = await acquirePaymentAttempt(sessionId, "blue");
  assert.equal(acquisition.ok, true);
  savePendingBluePaymentAttempt({ sessionId, paymentUrl: BLUE_URL, orderId: "A" });
  return acquisition.attempt;
}

beforeEach(() => {
  configurePaymentOutcomeStore(null);
  clearPaymentOutcomeLockUnlessSession(null);
  clearPendingBluePaymentAttempt();
});

test("before BLUE is started, both methods are selectable and payable", () => {
  for (const method of ["blue", "cybersource"]) assert.equal(checkoutAllows("S", method), true, method);
});

test("while the BLUE page is open, its attempt is in progress: Card waits, BLUE continues", async () => {
  configurePaymentOutcomeStore(disk().store);
  await sendBlueRequest("S");
  assert.equal(checkoutAllows("S", "cybersource"), false);
  assert.equal(checkoutAllows("S", "blue"), true);
});

test("BLUE → Back → Other: a BLUE reference alone does not disable Other", async () => {
  configurePaymentOutcomeStore(disk().store);
  const blue = await sendBlueRequest("S");
  parkPaymentAttempt("S"); // the BLUE page was left without a result
  assert.equal(readPaymentAttempt("S"), null);
  assert.equal(readParkedPaymentAttempt("S")?.id, blue.id);
  assert.equal(checkoutAllows("S", "cybersource"), true, "Other opens and proceeds");
  assert.equal(checkoutAllows("S", "blue"), true, "BLUE stays selectable");
  // The card screen's own pre-submit check sees no competing attempt either.
  assert.equal(isPaymentAttemptHeldByOther("S", null), false);
  const card = await acquirePaymentAttempt("S", "card");
  assert.equal(card.ok, true, "a card attempt of its own (a separate backend order)");
});

test("BLUE → Back → Other → Back → BLUE resumes the same stored URL and attempt (no second BLUE order)", async () => {
  configurePaymentOutcomeStore(disk().store);
  const blue = await sendBlueRequest("S");
  parkPaymentAttempt("S");
  // Other → Back: opening the card form holds nothing, so nothing changes.
  assert.equal(readParkedPaymentAttempt("S")?.id, blue.id);
  // BLUE again: Checkout's reusable path re-holds the parked attempt and reopens its URL.
  const resumed = await acquirePaymentAttempt("S", "blue");
  assert.equal(resumed.ok, true);
  assert.equal(resumed.attempt.id, blue.id, "the same BLUE attempt, not a new one");
  assert.equal(readPendingBluePaymentAttempt("S")?.paymentUrl, BLUE_URL, "the existing BLUE URL/reference");
  assert.equal(readParkedPaymentAttempt("S"), null);
});

test("Checkout's BLUE path never submits again while a reusable BLUE request exists", async () => {
  const checkout = strip(await read("../app/checkout.tsx"));
  const reuse = checkout.slice(checkout.indexOf("const reusableAttempt = readPendingBluePaymentAttempt("), checkout.indexOf("const checkoutBilling = createCheckoutBilling("));
  assert.match(reuse, /launchBluePayment\(\s*reusableAttempt\.paymentUrl,/);
  assert.match(reuse, /return;\s*\}\s*$/);
  assert.doesNotMatch(reuse, /checkoutService\.submit/);
});

test("an Other attempt never overwrites the stored BLUE reference; a definite card failure restores the parked BLUE", async () => {
  const d = disk();
  configurePaymentOutcomeStore(d.store);
  const blue = await sendBlueRequest("S");
  parkPaymentAttempt("S");
  const card = await acquirePaymentAttempt("S", "card");
  assert.equal(d.read().method, "card", "the running attempt owns the restart record");
  assert.equal(checkoutAllows("S", "blue"), false, "BLUE waits while the card attempt runs");
  assert.deepEqual(readPendingBluePaymentAttempt("S"), { sessionId: "S", paymentUrl: BLUE_URL, orderId: "A", purchasedMatchId: null }, "BLUE reference untouched");
  // The backend definitively rejected the card (e.g. 422): nothing was charged.
  await settlePaymentAttempt("S", card.attempt.id);
  assert.equal(readParkedPaymentAttempt("S")?.id, blue.id, "BLUE is still resumable");
  assert.equal(d.read().method, "blue", "the parked BLUE record comes back, not removed");
  assert.equal(checkoutAllows("S", "blue"), true);
  assert.equal(checkoutAllows("S", "cybersource"), true);
});

test("a restart with a parked BLUE request still fails closed (its URL lived only in memory)", async () => {
  const d = disk();
  configurePaymentOutcomeStore(d.store);
  await sendBlueRequest("S");
  parkPaymentAttempt("S");
  clearPaymentOutcomeLockUnlessSession(null); // the process ends
  clearPendingBluePaymentAttempt();
  await restorePaymentOutcomeLock("S");
  assert.deepEqual(readPaymentOutcomeLock("S"), { sessionId: "S", method: "blue" });
  for (const method of ["blue", "cybersource"]) assert.equal(checkoutAllows("S", method), false, method);
});

test("an unknown card outcome blocks every method, including resuming BLUE", async () => {
  configurePaymentOutcomeStore(disk().store);
  await sendBlueRequest("S");
  parkPaymentAttempt("S");
  await acquirePaymentAttempt("S", "card");
  markPaymentOutcomeUnknown("S", "card");
  assert.equal(readParkedPaymentAttempt("S"), null, "the lock supersedes the parked attempt");
  for (const method of ["blue", "cybersource"]) assert.equal(checkoutAllows("S", method), false, method);
  assert.equal((await acquirePaymentAttempt("S", "blue")).ok, false);
});

test("a definite BLUE failure (provider redirect) ends the BLUE attempt instead of parking it", async () => {
  const d = disk();
  configurePaymentOutcomeStore(d.store);
  await sendBlueRequest("S");
  await settlePaymentAttempt("S"); // BluePaymentScreen: failure redirect
  parkPaymentAttempt("S"); // the later unmount parks nothing
  assert.equal(readParkedPaymentAttempt("S"), null);
  assert.equal(d.read(), null);
});

test("only an in-progress BLUE attempt parks; a running card attempt is never parked", async () => {
  configurePaymentOutcomeStore(disk().store);
  await acquirePaymentAttempt("S", "card");
  parkPaymentAttempt("S");
  assert.equal(readPaymentAttempt("S")?.method, "card");
  assert.equal(readParkedPaymentAttempt("S"), null);
});

test("a parked attempt never leaks into another session", async () => {
  configurePaymentOutcomeStore(disk().store);
  await sendBlueRequest("S1");
  parkPaymentAttempt("S1");
  clearPaymentOutcomeLockUnlessSession("S2"); // a new session became current
  assert.equal(readParkedPaymentAttempt("S1"), null);
  assert.equal(readParkedPaymentAttempt("S2"), null);
});

test("authoritative success still owns cart clearing; a stale provider return cannot clear another session", () => {
  // Card success A for S cleared S; a BLUE return for S arriving later finds a different (or no) session.
  assert.equal(blueSuccessCompletion({ handoffSessionId: "S", currentSessionId: "S2", clear: "notAttempted" }), "unmatched");
  assert.equal(blueSuccessCompletion({ handoffSessionId: "S", currentSessionId: null, clear: "notAttempted" }), "unmatched");
  assert.equal(blueSuccessCompletion({ handoffSessionId: "S", currentSessionId: "S", clear: "cleared" }), "success");
});

test("BLUE deep-link result routes are display-only: they never clear a cart or touch the payment gate", async () => {
  for (const route of ["../app/checkout/blue/success.tsx", "../app/checkout/blue/failed.tsx"]) {
    const source = strip(await read(route));
    assert.doesNotMatch(source, /clearCart|captureCartSession|PaymentAttempt|PaymentOutcome|useCart/, route);
  }
});

test("leaving the BLUE page parks its attempt (before Checkout regains focus, and on unmount)", async () => {
  const screen = strip(await read("../components/BluePaymentScreen.native.tsx"));
  assert.match(screen, /if \(!leave\) return;\s*if \(!terminalHandledRef\.current && handoff\) parkPaymentAttempt\(handoff\.sessionId\);\s*clearBluePaymentHandoff\(handoffId\);\s*router\.dismissTo\("\/checkout"\);/);
  assert.match(screen, /clearBluePaymentHandoff\(handoffId\);\s*if \(!terminalHandledRef\.current && handoff\) parkPaymentAttempt\(handoff\.sessionId\);\s*\};/);
});

test("Checkout no longer asks the user to cancel BLUE before paying another way", async () => {
  const [checkout, flow, en] = await Promise.all([read("../app/checkout.tsx"), read("./checkoutFlow.ts"), read("../i18n/messages/en.ts")]);
  for (const source of [checkout, flow, en]) assert.doesNotMatch(source, /blueRequestOpen|attemptBlockReason/);
  assert.doesNotMatch(en, /cancel it on the BLUE page/);
  // The two methods, in order, without provider branding.
  assert.doesNotMatch(en, /"checkout\.method[^"]*":\s*"[^"]*CyberSource/i);
});

/* Home avatar ----------------------------------------------------------------- */

const resolveImage = (path) => (path.startsWith("http") ? path : `https://storage.example/${path}`);
const initialsOf = (name) => name.split(/\s+/).map((part) => part[0]).join("").toUpperCase();

test("Home avatar: the signed-in user's profile image, resolved like Profile's", () => {
  assert.deepEqual(
    homeAvatar({ isAuthenticated: true, user: { name: "Nour Shbaro", avatar: "avatars/u1.jpg" }, failedUri: null, resolveImage, initialsOf }),
    { kind: "image", uri: "https://storage.example/avatars/u1.jpg", initials: "NS" },
  );
});

test("Home avatar: without an image, the v3 initials; signed out, the person mark", () => {
  assert.deepEqual(homeAvatar({ isAuthenticated: true, user: { name: "Nour Shbaro", avatar: null }, failedUri: null, resolveImage, initialsOf }), { kind: "initials", initials: "NS" });
  assert.deepEqual(homeAvatar({ isAuthenticated: false, user: { name: "Nour Shbaro", avatar: "a.jpg" }, failedUri: null, resolveImage, initialsOf }), { kind: "person" });
  assert.deepEqual(homeAvatar({ isAuthenticated: true, user: null, failedUri: null, resolveImage, initialsOf }), { kind: "person" });
});

test("Home avatar: an image that fails to load falls back; a changed avatar is tried again", () => {
  const failed = "https://storage.example/avatars/u1.jpg";
  assert.deepEqual(homeAvatar({ isAuthenticated: true, user: { name: "Nour Shbaro", avatar: "avatars/u1.jpg" }, failedUri: failed, resolveImage, initialsOf }), { kind: "initials", initials: "NS" });
  assert.equal(homeAvatar({ isAuthenticated: true, user: { name: "Nour Shbaro", avatar: "avatars/u2.jpg" }, failedUri: failed, resolveImage, initialsOf }).kind, "image");
});

test("Home avatar reads AuthContext only: no profile request, no second user state or cache", async () => {
  const header = strip(await read("../components/TabHeader.tsx"));
  const brand = header.slice(header.indexOf("export function BrandHeader"));
  assert.match(brand, /homeAvatar\(\{\s*isAuthenticated: auth\.isAuthenticated,\s*user: auth\.user,/);
  assert.match(brand, /resolveImage: storageUrl,/);
  assert.match(brand, /onError=\{\(\) => setFailedUri\(avatar\.uri\)\}/);
  assert.doesNotMatch(header, /authService|\.me\(|apiRequest|refreshUser|storage\.|useEffect/);
  // Profile still publishes avatar changes to the same owner Home reads.
  const photo = await read("../hooks/useProfilePhoto.ts");
  assert.match(photo, /await auth\.updateUser\(nextUser\);/);
  // Tapping it keeps the Profile navigation.
  assert.match(brand, /setPrimaryTabTransitionDirection\(1\);\s*router\.replace\("\/profile"\);/);
});
