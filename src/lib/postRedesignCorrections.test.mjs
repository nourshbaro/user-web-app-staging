import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { en } from "../i18n/messages/en.ts";
import { credentialOutcome, credentialUserId } from "./authCredentialOutcome.ts";
import { checkoutResultRouteParams, parseCheckoutResultParams, singlePurchasedMatchId } from "./checkoutResultParams.ts";
import { purchasedTicketsAction } from "./checkoutResultPresentation.ts";
import { standingsPlanFor } from "./competitions.ts";
import { liveClockOf, matchesTabRoute, matchTabFromParam } from "./matchDiscovery.ts";
import { shortPlayerName } from "./playerName.ts";
import { purchasedTicketFocus, ticketFocusIndex, ticketVisualState } from "./ticketPresentation.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/* Home → Matches segments ------------------------------------------------ */

test("Home 'See all' opens Matches on the Live / Results segment; any other tab value is Upcoming", () => {
  assert.deepEqual(matchesTabRoute("live"), { pathname: "/matches", params: { tab: "live" } });
  assert.deepEqual(matchesTabRoute("results"), { pathname: "/matches", params: { tab: "results" } });
  assert.equal(matchesTabRoute("upcoming"), "/matches");
  assert.equal(matchTabFromParam("live"), "live");
  assert.equal(matchTabFromParam(["results", "live"]), "results");
  for (const value of [undefined, "", "LIVE", "completed", 3, null]) assert.equal(matchTabFromParam(value), "upcoming", String(value));
});

test("Home live / result cards open Match Details and 'See all' targets the right segment", async () => {
  const home = await read("../components/HomeFeed.tsx");
  assert.match(home, /<ScoreCard match=\{liveMatch\} onPress=\{\(\) => openMatch\(liveMatch\)\} \/>/);
  assert.match(home, /<ScoreCard match=\{latestResult\} onPress=\{\(\) => openMatch\(latestResult\)\} \/>/);
  assert.match(home, /onPress: \(\) => openAllMatches\("live"\)/);
  assert.match(home, /onPress: \(\) => openAllMatches\("results"\)/);
  const card = await read("../components/match/ScoreCard.tsx");
  assert.match(card, /<Pressable\s+onPress=\{onPress\}\s+accessibilityRole="button"/);
});

/* Live minute ------------------------------------------------------------ */

test("the live minute is the backend list clock only, and only for a live match", () => {
  assert.deepEqual(liveClockOf({ status: "live", clock_minute: 67, clock_running: true }), { minute: 67, running: true });
  assert.deepEqual(liveClockOf({ status: "live", clock_minute: 45, clock_running: false }), { minute: 45, running: false });
  // No minute is invented: null / missing / negative / non-numeric stay null.
  for (const clock_minute of [null, undefined, -1, Number.NaN, "67"]) {
    assert.equal(liveClockOf({ status: "live", clock_minute, clock_running: true }).minute, null, String(clock_minute));
  }
  // A stale clock on a non-live match is ignored.
  assert.deepEqual(liveClockOf({ status: "completed", clock_minute: 90, clock_running: false }), { minute: null, running: null });
  assert.deepEqual(liveClockOf({ status: "scheduled", clock_minute: 0, clock_running: false }), { minute: null, running: null });
});

/* Timeline player names --------------------------------------------------- */

test("timeline names follow v3 'F. LastName' without changing or inventing names", () => {
  assert.equal(shortPlayerName("Hassan Maatouk"), "H. Maatouk");
  assert.equal(shortPlayerName("Kassem El Zein"), "K. El Zein");
  assert.equal(shortPlayerName("  rodney   michael "), "R. michael");
  assert.equal(shortPlayerName("Ronaldinho"), "Ronaldinho");
  assert.equal(shortPlayerName("M. Hussein"), "M. Hussein");
  assert.equal(shortPlayerName("حسن معتوق"), "حسن معتوق");
  assert.equal(shortPlayerName(null), null);
  assert.equal(shortPlayerName("   "), null);
});

/* Competitions ------------------------------------------------------------ */

test("a cup (backend format) is decided by knockout: no standings request; anything else keeps the table", () => {
  assert.equal(standingsPlanFor("cup"), "knockout");
  for (const format of ["league", "Cup", "", null, undefined, "group"]) assert.equal(standingsPlanFor(format), "table", String(format));
});

test("the Competitions screen skips the standings request for a cup and keeps it for leagues", async () => {
  const screen = await read("../app/competitions.tsx");
  assert.match(screen, /const knockout = standingsPlanFor\(selected\?\.format\) === "knockout";/);
  assert.match(screen, /const standingsTask = knockout\s*\? Promise\.resolve\(\)\s*: competitionsService\s*\.standings\(id\)/);
});

/* Checkout presentation ----------------------------------------------------- */

test("no customer-facing copy names the card provider", () => {
  const branded = Object.entries(en).filter(([, value]) => /cyber\s*source/i.test(value));
  assert.deepEqual(branded, []);
  assert.equal(en["checkout.payment.card.title"], "Other");
  assert.equal(en["checkout.payment.blue.title"], "BLUE Wallet");
});

/* Purchased ticket navigation ------------------------------------------------ */

test("'View my ticket' opens the one purchased match; several matches keep the list", () => {
  assert.equal(singlePurchasedMatchId({ 4: [{ holder_name: "A" }, { holder_name: "B" }] }), "4");
  assert.equal(singlePurchasedMatchId({ 4: [{ holder_name: "A" }], 9: [{ holder_name: "B" }] }), null);
  assert.equal(singlePurchasedMatchId({ 4: [], 9: [{ holder_name: "B" }] }), "9");
  assert.equal(singlePurchasedMatchId({ "../x": [{ holder_name: "A" }] }), null);
  assert.equal(singlePurchasedMatchId(null), null);

  const result = parseCheckoutResultParams({ provider: "cybersource", match_id: "4", order_number: "ORD-1021" });
  assert.equal(result.match_id, "4");
  assert.deepEqual(checkoutResultRouteParams(result), { provider: "cybersource", match_id: "4", order_number: "ORD-1021" });
  assert.deepEqual(purchasedTicketsAction(result), {
    labelKey: "result.success.ticket",
    href: { pathname: "/tickets", params: { match: "4", order: "ORD-1021" } },
  });
  // No match id (multi-match, BLUE web return): the My Tickets list.
  assert.deepEqual(purchasedTicketsAction(parseCheckoutResultParams({ provider: "blue", order_number: "ORD-1" })), { labelKey: "result.success.tickets", href: "/tickets" });
  // A non-numeric match id is never forwarded.
  assert.equal(parseCheckoutResultParams({ provider: "blue", match_id: "4;drop" }).match_id, undefined);
});

test("My Tickets opens the purchased order's first ticket, never a guessed one", () => {
  assert.deepEqual(purchasedTicketFocus({ match: "4", order: "ORD-1021" }), { matchId: 4, order: "ORD-1021" });
  assert.deepEqual(purchasedTicketFocus({ match: ["4"] }), { matchId: 4, order: null });
  assert.equal(purchasedTicketFocus({ match: "abc" }), null);
  assert.equal(purchasedTicketFocus({}), null);
  const tickets = [{ order_code: "ORD-1000" }, { order_code: "ORD-1021" }, { order_code: "ORD-1021" }];
  assert.equal(ticketFocusIndex(tickets, "ORD-1021"), 1);
  assert.equal(ticketFocusIndex(tickets, "1021"), 1, "the portal strips ORD-");
  assert.equal(ticketFocusIndex(tickets, "ORD-9999"), 0);
  assert.equal(ticketFocusIndex(tickets, null), 0);
});

test("payment completion hands over the purchased match as display data only", async () => {
  const card = await read("../components/CardPaymentScreen.tsx");
  assert.match(card, /match_id: singlePurchasedMatchId\(handoff\.request\.tickets_by_match\)/);
  const blue = await read("../components/BluePaymentScreen.native.tsx");
  // The handoff's own submitted match, through the shared helper (behaviour: blueResumeRouting.test.mjs).
  assert.match(blue, /params: blueSuccessResultParams\(handoff, displayParams\),/);
  // The cart is still cleared only by the existing same-session terminal paths.
  assert.match(card, /const cleared = await cart\.clearCartIfSession\(cartTicket\);/);
});

/* Ticket flip ----------------------------------------------------------------- */

test("the whole ticket surface flips it; nested buttons keep their own action; state stays backend-driven", async () => {
  const screen = await read("../app/tickets.tsx");
  assert.match(screen, /<Pressable accessible=\{false\} onPress=\{\(\) => setFlipped\(true\)\} style=\{local\.faceSurface\}>/);
  assert.match(screen, /<Pressable accessible=\{false\} onPress=\{\(\) => setFlipped\(false\)\} style=\{local\.faceSurface\}>/);
  // Explicit faces, not a toggle: a web click reaching button and surface lands on the same face.
  assert.doesNotMatch(screen, /setFlipped\(\(value\) => !value\)|setFlipped\(!flipped\)/);
  // Reduced motion: no turn, no stamp / QR entrance.
  assert.match(screen, /if \(reducedMotion\) \{[\s\S]*?turn\.setValue\(flipped \? 1 : 0\);[\s\S]*?stampIn\.setValue\(1\);/);
  assert.equal(ticketVisualState({ status: "valid", checked_in_at: "2026-10-22T13:02:00Z" }), "used");
  assert.equal(ticketVisualState({ status: "refunded", checked_in_at: null }), "other");
});

/* Auth ------------------------------------------------------------------------- */

test("Login / Register ask for a code only when the backend withholds the session", () => {
  assert.equal(credentialOutcome({ token: "t", user: { id: 1 } }), "session");
  assert.equal(credentialOutcome({ data: { access_token: "t" } }), "session");
  assert.equal(credentialOutcome({ user_id: 7 }), "verify");
  assert.equal(credentialOutcome({ data: { user: { id: "7" } } }), "verify");
  assert.equal(credentialOutcome({ message: "Account created" }), "signIn");
  assert.equal(credentialOutcome(null), "signIn");
  assert.equal(credentialUserId({ data: { user_id: 3 } }), "3");
});

test("no client-imposed OTP after Login / Register; Forgot Password keeps its code", async () => {
  const auth = await read("../app/auth.tsx");
  assert.doesNotMatch(auth, /checkEmailVerification|getVerificationStatus/);
  const register = auth.slice(auth.indexOf(`if (mode === "register")`), auth.indexOf(`if (mode === "otp")`));
  assert.match(register, /const outcome = credentialOutcome\(payload\);\s*if \(outcome === "verify"\) \{/);
  assert.match(auth, /if \(credentialOutcome\(payload\) === "verify"\) \{/);
  assert.match(auth, /authService\.forgotPassword\(/);
  assert.match(auth, /authService\.verifyForgotPasswordOtp\(/);
  assert.match(auth, /authService\.resetPassword\(/);
});

/* Timeline / Stats motion ---------------------------------------------------------- */

test("Timeline / Stats use the shared sliding control; their row entrance is skipped under reduced motion", async () => {
  const view = await read("../components/match/MatchInfoView.tsx");
  assert.match(view, /<SegmentedControl[\s\S]*?value=\{tab\}\s*onChange=\{setTab\}/);
  assert.match(view, /const motion = timelineRowMotion\(index, reducedMotion\);\s*return motion \? FadeInDown\.delay\(motion\.delay\)\.duration\(motion\.duration\) : undefined;/);
  assert.match(view, /entering=\{rowEntrance\(index, reducedMotion\)\}/);
  const control = await read("../components/foundation/SegmentedControl.tsx");
  assert.match(control, /if \(reducedMotion\) \{\s*thumb\.setValue\(index\);\s*return;\s*\}/);
});
