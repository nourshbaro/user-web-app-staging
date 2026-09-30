import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  datesWithMatches,
  dateStripForTab,
  latestCompletedMatch,
  matchQueryFor,
  matchScore,
  matchStatusPresentation,
  statusForTab,
} from "./matchDiscovery.ts";
import { selectNextTicketMatch } from "./homeTickets.ts";

// v3 fidelity pass: Upcoming / Live / Results backed by the confirmed
// `/matches/scheduled?status=live|completed` contract (staging: any other
// status value is rejected with 422; team/stadium/date compose server-side).

test("tabs map to exactly the statuses the backend accepts", () => {
  assert.equal(statusForTab("upcoming"), undefined);
  assert.equal(statusForTab("live"), "live");
  assert.equal(statusForTab("results"), "completed");
});

test("one backend query per selection; an explicit date is sent for every tab (status=live&date=… is valid)", () => {
  const filters = { team: "ansar", stadium: "fouad-chehab-stadium", date: "2026-10-22" };
  assert.deepEqual(matchQueryFor(filters, "upcoming"), { ...filters, status: undefined });
  assert.deepEqual(matchQueryFor(filters, "live"), { ...filters, status: "live" });
  assert.deepEqual(matchQueryFor(filters, "results"), { ...filters, status: "completed" });
  // No invented status for Upcoming, and no date when none was chosen.
  assert.deepEqual(matchQueryFor({}, "live"), { team: undefined, stadium: undefined, date: undefined, status: "live" });
});

test("confirmed backend statuses get their own presentation; anything else stays neutral and verbatim", () => {
  assert.deepEqual(matchStatusPresentation("live"), { known: "live", tone: "live", raw: "live" });
  assert.deepEqual(matchStatusPresentation("Completed"), { known: "completed", tone: "neutral", raw: "completed" });
  assert.equal(matchStatusPresentation("postponed").known, null);
  assert.notEqual(matchStatusPresentation("postponed").tone, "live");
});

test("scores come only from both backend numbers, never defaulted or partial", () => {
  assert.equal(matchScore({ home_score: 1, away_score: 3 }), "1–3");
  assert.equal(matchScore({ home_score: 0, away_score: 0 }), "0–0");
  for (const partial of [{}, { home_score: null, away_score: null }, { home_score: 2, away_score: null }, { home_score: Number.NaN, away_score: 1 }, { home_score: "1", away_score: "2" }]) {
    assert.equal(matchScore(partial), null, JSON.stringify(partial));
  }
});

test("v3 date strips: Upcoming = today + 12 days, Results = the 7 days before today, Live = none", () => {
  const today = new Date(2026, 8, 29);
  const upcoming = dateStripForTab("upcoming", today);
  assert.equal(upcoming.length, 13);
  assert.equal(upcoming[0], "2026-09-29");
  assert.equal(upcoming[12], "2026-10-11");
  assert.deepEqual(dateStripForTab("results", today), ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
  assert.deepEqual(dateStripForTab("live", today), []);
  // A selected day outside the strip stays visible.
  assert.equal(dateStripForTab("results", today, "2026-01-30")[0], "2026-01-30");
});

test("date dots are the real fixture dates only", () => {
  const dates = datesWithMatches([{ match_date: "2026-10-22" }, { match_date: "2026-10-22" }, { match_date: "nope" }, { match_date: "2026-12-30" }]);
  assert.deepEqual([...dates].sort(), ["2026-10-22", "2026-12-30"]);
});

test("latest result = most recent valid kickoff; undated results are never preferred", () => {
  const rows = [
    { id: 1, match_date: "2026-01-30", kickoff_at: "14:15:00" },
    { id: 2, match_date: "2026-03-01", kickoff_at: "18:00:00" },
    { id: 3, match_date: "bad", kickoff_at: "18:00:00" },
  ];
  assert.equal(latestCompletedMatch(rows).id, 2);
  assert.equal(latestCompletedMatch([rows[2]]).id, 3);
  assert.equal(latestCompletedMatch([]), null);
});

test("Home tickets card: the earliest upcoming portal match that actually has tickets", () => {
  const portal = (match_id, kickoff_at, extra = {}) => ({ match_id, kickoff_at, is_upcoming: true, ticket_count: 2, ...extra });
  assert.equal(selectNextTicketMatch([]), null);
  assert.equal(selectNextTicketMatch([portal(1, "2026-10-22T13:00:00Z", { ticket_count: 0 })]), null);
  assert.equal(selectNextTicketMatch([portal(1, "2026-10-22T13:00:00Z", { is_upcoming: false })]), null);
  const next = selectNextTicketMatch([portal(1, "2026-12-30T14:15:00Z"), portal(2, "2026-10-22T13:00:00Z"), portal(3, "not a date")]);
  assert.equal(next.match_id, 2);
});

test("the status is part of the request identity, so tab switches can never show another tab's rows", async () => {
  const hook = await readFile(new URL("../hooks/useScheduledMatches.ts", import.meta.url), "utf8");
  assert.match(hook, /createRequestIdentity\(\[filters\.team, filters\.stadium, filters\.date, filters\.status\]\)/);
  assert.match(hook, /status: filters\.status \};/);
});

test("an explicit Live date stays visible in the applied summary, even when nothing matches", async () => {
  const list = await readFile(new URL("../components/MatchesList.tsx", import.meta.url), "utf8");
  // The summary is built from the query actually sent (which now keeps the Live date)…
  assert.match(list, /query\.date \? formatCalendarDate\(query\.date\) : undefined/);
  // …and is shown for results AND for the filtered-empty state.
  assert.match(list, /summary=\{state === "results" \|\| state === "filtered-empty" \? summary : undefined\}/);
});
