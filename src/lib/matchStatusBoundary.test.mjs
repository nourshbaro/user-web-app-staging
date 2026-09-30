import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { confirmedPublication } from "./cartPublication.ts";
import { checkoutBackBlocked, checkoutBackHandlers } from "./checkoutFlow.ts";
import { formatEventMinute, matchDetailFacts, scorerLines, statRows, timelineRows } from "./matchDetailFacts.ts";
import {
  commitEffects,
  executeSelectionCommit,
  isPurchasableMatchStatus,
  matchDetailExperience,
} from "./ticketSelection.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/* ------------------------------------------------------------------------ *
 * Fixtures: structurally the confirmed staging responses (2026-09-30).
 * ------------------------------------------------------------------------ */

const zones = [
  { id: 1, name: "Zone A", has_seats: false, shape_type: "polygon", shape_data: [], price: "10.00", currency: "USD", capacity: null },
  { id: 2, name: "Zone B", has_seats: false, shape_type: "polygon", shape_data: [], price: "10.00", currency: "USD", capacity: null },
  { id: 3, name: "VIP", has_seats: true, shape_type: "polygon", shape_data: [], price: "100.00", currency: "USD", capacity: null },
];

/** GET /api/matches/single/16 while live. */
const match16 = {
  id: 16,
  match_date: "2026-09-30",
  kickoff_at: "11:00:00",
  status: "live",
  home_team: { id: 12, name: "Nejmeh", logo: "teams/logos/n.png" },
  away_team: { id: 2, name: "Ansar", logo: "teams/logos/a.png" },
  competition: { id: 3, name: "this is a test", short_name: "TIAT", slug: "this-is-a-test", logo: "competitions/logos/c.png" },
  season: { id: 3, label: "26-2027", is_current: true },
  matchday: 2,
  round_name: null,
  matchday_label: "Matchday 2",
  home_score: 1,
  away_score: null,
  clock: { minute: 49, running: false },
  events: [
    {
      id: 1,
      type: "goal",
      team: { id: 12, name: "Nejmeh", short_name: null, logo: "teams/logos/n.png" },
      player: { id: 1, name: "Sierra Leone", shirt_number: 17 },
      player_in: null,
      player_out: null,
      minute: 1,
      extra_minute: null,
    },
  ],
  stats: {
    possession: { home: 3, away: 97 },
    shots: { home: 1, away: 1 },
    shots_on_target: { home: 1, away: 1 },
    corners: { home: 1, away: 1 },
    fouls: { home: 1, away: 1 },
  },
  stadium: { id: 9, name: "Fouad Chehab Stadium", location: "Jounieh, Lebanon", map_image: "stadiums/maps/m.svg", zones },
};

const scheduled = { ...match16, status: "scheduled", home_score: null, away_score: null, clock: { minute: null, running: false }, events: [], stats: { possession: null, shots: { home: null, away: null } } };
const completed = { ...match16, status: "completed", away_score: 0, clock: { minute: null, running: false } };

/**
 * The screen's commit wiring, as a harness: a backend with a mutable match
 * status (the single status authority), a cart owner that records every
 * mutation, and the same `confirmStillOnSale` the screen passes (re-read the
 * match, then ask `isPurchasableMatchStatus`).
 */
function harness(initialStatus) {
  const backend = { status: initialStatus, reads: 0, failRead: false };
  const cartCalls = [];
  const published = [];
  let screenMatch = null;
  const readMatch = async () => {
    backend.reads += 1;
    if (backend.failRead) throw new Error("offline");
    return { ...match16, status: backend.status };
  };
  const mutate = (name, line) => async () => {
    cartCalls.push(name);
    published.push(line);
    return confirmedPublication("S1", [...published]);
  };
  const ops = {
    addZone: (zoneId, quantity) => mutate(`add:${zoneId}:${quantity}`, { lock_key: `L${zoneId}`, match_id: "16", stadium_zone_id: String(zoneId), type: "zone", quantity })(),
    setZone: (lockKey, quantity) => mutate(`set:${lockKey}:${quantity}`, {})(),
    removeLine: (lockKey) => mutate(`remove:${lockKey}`, {})(),
    addSeats: (zoneId, seatIds) => mutate(`seats:${zoneId}`, { lock_key: `S${zoneId}`, match_id: "16", stadium_zone_id: String(zoneId), type: "seats", quantity: seatIds.length, seat_ids: [...seatIds] })(),
    currentSessionId: () => "S1",
    confirmStillOnSale: async () => {
      const current = await readMatch();
      screenMatch = current; // the screen re-renders from the fresh match
      return isPurchasableMatchStatus(current.status);
    },
  };
  return { backend, cartCalls, ops, screen: () => screenMatch };
}

const gaPlan = { matchId: "16", gaChanges: [{ zoneId: 1, from: 0, to: 2, action: "add", lockKey: null }], seats: null };
const seatPlan = { matchId: "16", gaChanges: [], seats: { zoneId: 3, seatIds: [301, 302] } };

/* ------------------------------------------------------------------------ *
 * Status gating.
 * ------------------------------------------------------------------------ */

test("only a scheduled match is purchasable; zones never imply it", () => {
  assert.equal(matchDetailExperience(scheduled.status), "purchase");
  assert.equal(matchDetailExperience(match16.status), "live");
  assert.equal(matchDetailExperience(completed.status), "result");
  for (const status of ["postponed", "cancelled", "", null, undefined, "Scheduled "]) {
    assert.equal(matchDetailExperience(status) === "purchase", status === "Scheduled ", String(status));
  }
  // The live fixture carries zones, yet it is not a purchase experience.
  assert.equal(match16.stadium.zones.length, 3);
  assert.equal(isPurchasableMatchStatus(match16.status), false);
});

test("scheduled with zones: GA and reserved selections reach the cart owner", async () => {
  const ga = harness("scheduled");
  const gaOutcome = await executeSelectionCommit(gaPlan, ga.ops);
  assert.equal(gaOutcome.status, "confirmed");
  assert.deepEqual(ga.cartCalls, ["add:1:2"]);
  assert.equal(ga.backend.reads, 1, "status re-read once, before the mutation");

  const seats = harness("scheduled");
  const seatOutcome = await executeSelectionCommit(seatPlan, seats.ops);
  assert.equal(seatOutcome.status, "confirmed");
  assert.deepEqual(seats.cartCalls, ["seats:3"]);
});

test("live with zones: a selection commit makes zero cart mutations", async () => {
  for (const plan of [gaPlan, seatPlan]) {
    const live = harness("live");
    const outcome = await executeSelectionCommit(plan, live.ops);
    assert.deepEqual(outcome, { status: "notOnSale" });
    assert.deepEqual(live.cartCalls, [], "no cart mutation");
    assert.deepEqual(commitEffects(outcome, null), { success: false, needsReconcile: false, discardDraft: true });
  }
});

test("completed with zones: zero cart mutations", async () => {
  const done = harness("completed");
  const outcome = await executeSelectionCommit(gaPlan, done.ops);
  assert.equal(outcome.status, "notOnSale");
  assert.deepEqual(done.cartCalls, []);
});

test("scheduled → user selects → backend goes live → commit: rejected with zero mutations, screen reconciles to live", async () => {
  const h = harness("scheduled");
  // Loaded scheduled; the draft exists (GA 2 in Zone A + two seats).
  assert.equal(matchDetailExperience(h.backend.status), "purchase");
  // Kick-off happens on the backend before the user confirms.
  h.backend.status = "live";
  const outcome = await executeSelectionCommit({ ...gaPlan, seats: seatPlan.seats }, h.ops);
  assert.equal(outcome.status, "notOnSale");
  assert.deepEqual(h.cartCalls, []);
  // The re-read match is what the screen now renders: the live experience.
  assert.equal(matchDetailExperience(h.screen().status), "live");
  // The stale draft is discarded, and no cart reconcile is needed (nothing was sent).
  const effects = commitEffects(outcome, null);
  assert.equal(effects.discardDraft, true);
  assert.equal(effects.needsReconcile, false);
});

test("an unverifiable status (re-read fails) also makes zero mutations and keeps the draft", async () => {
  const h = harness("scheduled");
  h.backend.failRead = true;
  const outcome = await executeSelectionCommit(gaPlan, h.ops);
  assert.equal(outcome.status, "statusUnverified");
  assert.deepEqual(h.cartCalls, []);
  assert.deepEqual(commitEffects(outcome, null), { success: false, needsReconcile: false, discardDraft: false });
});

/* ------------------------------------------------------------------------ *
 * Live / completed presentation from the real API shape.
 * ------------------------------------------------------------------------ */

test("live match 16: score, minute, goal timeline and statistics come from the backend", () => {
  const facts = matchDetailFacts(match16);
  assert.equal(facts.homeScore, 1);
  assert.equal(facts.awayScore, null, "a null away score is not 0");
  assert.equal(facts.score, null, "no combined score while one side is missing");
  assert.equal(facts.liveMinute, 49);
  assert.equal(facts.clockRunning, false);
  assert.equal(facts.roundLabel, "Matchday 2");

  const rows = timelineRows(match16);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    key: "1-0",
    kind: "goal",
    side: "home",
    minuteLabel: "1'",
    player: "Sierra Leone",
    shirtNumber: 17,
    teamName: "Nejmeh",
  });
  assert.deepEqual(scorerLines(rows), { home: ["Sierra Leone 1'"], away: [] });

  const stats = statRows(match16);
  assert.deepEqual(stats.map((row) => [row.key, row.home, row.away, row.unit]), [
    ["possession", 3, 97, "%"],
    ["shots", 1, 1, ""],
    ["shots_on_target", 1, 1, ""],
    ["corners", 1, 1, ""],
    ["fouls", 1, 1, ""],
  ]);
  assert.deepEqual([stats[0].homeShare, stats[0].awayShare], [3, 97]);
});

test("completed: final result presentation with supplied events and stats", () => {
  const facts = matchDetailFacts(completed);
  assert.deepEqual(facts.score, { home: 1, away: 0 });
  assert.equal(facts.liveMinute, null);
  assert.equal(timelineRows(completed).length, 1);
  assert.equal(statRows(completed).length, 5);
});

test("event minutes: 1', 45+2', and none when the backend sends none", () => {
  assert.equal(formatEventMinute(1, null), "1'");
  assert.equal(formatEventMinute(45, 2), "45+2'");
  assert.equal(formatEventMinute(90, 0), "90'");
  assert.equal(formatEventMinute(null, 3), null);
});

test("partial/null data is never fabricated", () => {
  const empty = { ...match16, home_score: null, away_score: null, clock: { minute: null, running: false }, events: [], stats: { possession: null, shots: { home: null, away: null }, corners: { home: 2, away: null } } };
  const facts = matchDetailFacts(empty);
  assert.equal(facts.homeScore, null);
  assert.equal(facts.awayScore, null);
  assert.equal(facts.liveMinute, null, "no invented minute");
  assert.deepEqual(timelineRows(empty), [], "no timeline rows");
  const stats = statRows(empty);
  // Only corners had a value; its missing side stays null and no bars are drawn.
  assert.deepEqual(stats, [{ key: "corners", home: 2, away: null, unit: "", homeShare: null, awayShare: null }]);
  assert.deepEqual(statRows({ ...match16, stats: null }), []);
});

test("unknown event types and unmatched teams carry no invented meaning", () => {
  const odd = {
    ...match16,
    events: [
      { id: 7, type: "var_review", team: { id: 99, name: "Other FC" }, player: null, minute: 30, extra_minute: null },
      { id: 8, type: "goal", team: { id: 2, name: "Ansar" }, player: { id: 4, name: "J. Nasr", shirt_number: 9 }, minute: 45, extra_minute: 2 },
    ],
  };
  const rows = timelineRows(odd);
  assert.deepEqual(rows.map((row) => [row.kind, row.side, row.minuteLabel, row.player]), [
    ["other", null, "30'", null],
    ["goal", "away", "45+2'", "J. Nasr"],
  ]);
  assert.deepEqual(scorerLines(rows), { home: [], away: ["J. Nasr 45+2'"] });
});

test("the info view renders no purchase control and is the only branch for non-scheduled matches", async () => {
  const route = await read("../app/match/[id].tsx");
  const view = await read("../components/match/MatchInfoView.tsx");
  assert.doesNotMatch(view, /ZoneList|ZoneRow|GaZoneStepper|SeatMap|TransactionBar|useCart|addItem|chooseSeats|selection\.add/);
  // The non-purchase branch returns before any purchase UI is built.
  const branch = route.indexOf('if (experience !== "purchase") {');
  assert.ok(branch > 0);
  for (const marker of ["<ZoneList", "<GaZoneStepper", "<TransactionBar", "<SeatMap"]) {
    assert.ok(route.indexOf(marker, branch) > branch, marker);
  }
  // A non-scheduled match never selects a zone (so no seat request either).
  assert.match(route, /const nextZone = !isPurchasableMatchStatus\(data\.status\)\s*\? null/);
});

/* ------------------------------------------------------------------------ *
 * Checkout Back.
 * ------------------------------------------------------------------------ */

test("Checkout Back: works idle, is blocked in flight on header and hardware, and resumes after", () => {
  const state = { submitInFlight: false, handoffStarted: false };
  const navigations = [];
  const back = checkoutBackHandlers(() => checkoutBackBlocked(state), () => navigations.push("/cart"));

  back.header();
  assert.deepEqual(navigations, ["/cart"], "idle header Back returns to Cart");
  assert.equal(back.hardware(), true);
  assert.deepEqual(navigations, ["/cart", "/cart"], "idle hardware Back returns to Cart");

  state.submitInFlight = true;
  back.header();
  assert.equal(back.hardware(), true, "hardware Back is consumed, never the default pop");
  assert.equal(navigations.length, 2, "no navigation while a submit is in flight");

  state.submitInFlight = false;
  state.handoffStarted = true;
  back.header();
  back.hardware();
  assert.equal(navigations.length, 2, "no navigation once the payment handoff started");

  state.handoffStarted = false;
  back.header();
  assert.equal(navigations.length, 3, "Back resumes when production state allows it");
});

test("Checkout wires both Back entry points to the shared policy and disables the header while submitting", async () => {
  const checkout = await read("../app/checkout.tsx");
  assert.match(checkout, /checkoutBackBlocked\(\{ submitInFlight: submitInFlightRef\.current, handoffStarted: blueHandoffStartedRef\.current \}\)/);
  assert.match(checkout, /"hardwareBackPress",\s*onHardwareBack,/);
  assert.match(checkout, /onBack=\{onHeaderBack\}\s*backDisabled=\{loading\}/);
  assert.match(checkout, /const onHeaderBack = useCallback\(\(\) => checkoutBackHandlers\(isBackBlocked, leaveToCart\)\.header\(\)/);
  assert.match(checkout, /const onHardwareBack = useCallback\(\(\) => checkoutBackHandlers\(isBackBlocked, leaveToCart\)\.hardware\(\)/);
});
