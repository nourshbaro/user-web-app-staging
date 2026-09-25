import assert from "node:assert/strict";
import test from "node:test";
import {
  activeFilterCount,
  getCalendarDays,
  isBeforeDay,
  matchKickoffTime,
  matchListState,
  matchStatusPresentation,
  nextKickoffAfter,
  selectHomeMatches,
  sortMatchesByKickoff,
  teamInitials,
  toDateInputValue,
} from "./matchDiscovery.ts";

const match = (id, match_date, kickoff_at, extra = {}) => ({
  id,
  match_date,
  kickoff_at,
  status: "scheduled",
  home_team: { id: 1, name: "Ansar" },
  away_team: { id: 2, name: "Mabarrah" },
  ...extra,
});

// ---- Strict kickoff parsing -------------------------------------------------

test("valid date + clock kickoff is read as local wall-clock time", () => {
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "13:00:00")), new Date(2026, 9, 22, 13, 0).getTime());
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "8:05")), new Date(2026, 9, 22, 8, 5).getTime());
});

test("missing or malformed kickoff is UNKNOWN, never midnight", () => {
  for (const kickoff of ["", "   ", "abc", "13", "13:0", "1300", undefined, null]) {
    assert.equal(matchKickoffTime(match(1, "2026-10-22", kickoff)), null, String(kickoff));
  }
});

test("out-of-range hour, minute or second is unknown", () => {
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "25:00")), null);
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "24:00")), null);
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "13:60")), null);
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "13:30:61")), null);
});

test("impossible calendar dates are rejected instead of rolling over", () => {
  assert.equal(matchKickoffTime(match(1, "2026-02-30", "13:00")), null);
  assert.equal(matchKickoffTime(match(1, "2026-13-01", "13:00")), null);
  assert.equal(matchKickoffTime(match(1, "2026-00-10", "13:00")), null);
  assert.equal(matchKickoffTime(match(1, "", "13:00")), null);
  assert.equal(matchKickoffTime(match(1, "22/10/2026", "13:00")), null);
});

test("Feb 29 is valid only in leap years", () => {
  assert.equal(matchKickoffTime(match(1, "2028-02-29", "18:00")), new Date(2028, 1, 29, 18, 0).getTime());
  assert.equal(matchKickoffTime(match(1, "2026-02-29", "18:00")), null);
});

test("well-formed ISO kickoff stays supported; malformed ISO is unknown", () => {
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "2026-10-22T13:00:00Z")), Date.parse("2026-10-22T13:00:00Z"));
  assert.equal(matchKickoffTime(match(1, "2026-10-22", "2026-02-30T13:00:00Z")), null);
});

test("unknown kickoffs sort last in original order", () => {
  const sorted = sortMatchesByKickoff([
    match("late", "2026-10-22", "16:30"),
    match("unknown-a", "2026-10-22", ""),
    match("early", "2026-10-22", "13:00"),
    match("unknown-b", "2026-02-30", "10:00"),
    match("tomorrow", "2026-10-21", "20:00"),
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["tomorrow", "early", "late", "unknown-a", "unknown-b"]);
});

// ---- Home selection -----------------------------------------------------------

const fixtures = [
  match("past", "2026-10-22", "13:00"),
  match("unknown", "2026-10-22", ""),
  match("next", "2026-10-22", "16:30"),
  match("week", "2026-10-29", "18:00"),
];

test("before kickoff the earliest valid upcoming match is featured", () => {
  const { featured, upcoming, nextBoundary } = selectHomeMatches(fixtures, new Date(2026, 9, 22, 12, 0).getTime(), 5);
  assert.equal(featured.id, "past");
  assert.deepEqual(upcoming.map((item) => item.id), ["next", "week"]);
  assert.equal(nextBoundary, new Date(2026, 9, 22, 13, 0).getTime());
});

test("after kickoff the feature moves on without any new data", () => {
  // Same array (no refetch), later presentation time.
  const { featured, upcoming } = selectHomeMatches(fixtures, new Date(2026, 9, 22, 14, 0).getTime(), 5);
  assert.equal(featured.id, "next");
  assert.deepEqual(upcoming.map((item) => item.id), ["week"]);
});

test("Upcoming never contains passed or unknown-kickoff fixtures, nor the featured one", () => {
  const { featured, upcoming } = selectHomeMatches(fixtures, new Date(2026, 9, 22, 14, 0).getTime(), 5);
  const ids = upcoming.map((item) => item.id);
  assert.equal(ids.includes("past"), false);
  assert.equal(ids.includes("unknown"), false);
  assert.equal(ids.includes(featured.id), false);
});

test("an unknown kickoff is never featured, even when it is the only match", () => {
  const { featured, upcoming, nextBoundary } = selectHomeMatches([match("unknown", "2026-10-22", "")], 0, 5);
  assert.equal(featured, null);
  assert.deepEqual(upcoming, []);
  assert.equal(nextBoundary, null);
});

test("once every kickoff has passed there is no feature and no upcoming list", () => {
  const { featured, upcoming } = selectHomeMatches(fixtures, new Date(2026, 11, 1).getTime(), 5);
  assert.equal(featured, null);
  assert.deepEqual(upcoming, []);
});

test("Home shows at most 5 matches: the featured one plus up to 4 upcoming", () => {
  const many = Array.from({ length: 9 }, (_, index) => match(index, `2026-10-${String(10 + index).padStart(2, "0")}`, "18:00"));
  const { featured, upcoming } = selectHomeMatches(many, new Date(2026, 0, 1).getTime(), 5);
  assert.equal(featured.id, 0);
  assert.deepEqual(upcoming.map((item) => item.id), [1, 2, 3, 4]);
});

test("selection is deterministic for ties (original order breaks equal kickoffs)", () => {
  const tied = [match("a", "2026-10-22", "18:00"), match("b", "2026-10-22", "18:00")];
  for (let run = 0; run < 3; run += 1) {
    assert.equal(selectHomeMatches(tied, 0, 5).featured.id, "a");
  }
});

test("next boundary is the next valid kickoff strictly after now", () => {
  assert.equal(nextKickoffAfter(fixtures, new Date(2026, 9, 22, 12, 0).getTime()), new Date(2026, 9, 22, 13, 0).getTime());
  assert.equal(nextKickoffAfter(fixtures, new Date(2026, 9, 22, 13, 0).getTime()), new Date(2026, 9, 22, 16, 30).getTime());
  assert.equal(nextKickoffAfter(fixtures, new Date(2026, 11, 1).getTime()), null);
  assert.equal(nextKickoffAfter([match("u", "2026-10-22", "")], 0), null);
});

// ---- Lists, filters, statuses ------------------------------------------------------

test("list state separates loading, error, global empty, filtered empty and results", () => {
  assert.equal(matchListState({ loading: true, error: null, count: 0, filters: {} }), "loading");
  assert.equal(matchListState({ loading: false, error: "offline", count: 0, filters: {} }), "error");
  assert.equal(matchListState({ loading: false, error: null, count: 0, filters: {} }), "empty");
  assert.equal(matchListState({ loading: false, error: null, count: 0, filters: { team: "ansar" } }), "filtered-empty");
  assert.equal(matchListState({ loading: false, error: null, count: 2, filters: { team: "ansar" } }), "results");
  assert.equal(matchListState({ loading: false, error: "offline", count: 2, filters: {} }), "results");
});

test("active filter count covers team, venue and date", () => {
  assert.equal(activeFilterCount({}), 0);
  assert.equal(activeFilterCount({ team: "ansar", date: "2026-10-22" }), 2);
  assert.equal(activeFilterCount({ team: "a", stadium: "b", date: "c" }), 3);
});

test("only a backend 'scheduled' maps to Scheduled; blank is unknown; others stay neutral", () => {
  assert.deepEqual(matchStatusPresentation("scheduled"), { known: "scheduled", tone: "info", raw: "scheduled" });
  assert.deepEqual(matchStatusPresentation("Scheduled"), { known: "scheduled", tone: "info", raw: "scheduled" });
  for (const blank of ["", "   ", null, undefined]) {
    assert.deepEqual(matchStatusPresentation(blank), { known: "unknown", tone: "neutral", raw: "" }, String(blank));
  }
  const other = matchStatusPresentation("postponed_by_league");
  assert.equal(other.known, null);
  assert.equal(other.tone, "neutral");
  assert.equal(other.raw, "postponed by league");
  for (const status of ["scheduled", "postponed", "", "whatever"]) {
    assert.notEqual(matchStatusPresentation(status).tone, "live");
  }
});

test("crest fallback uses short name, else initials", () => {
  assert.equal(teamInitials({ name: "Ansar", short_name: "ANS" }), "ANS");
  assert.equal(teamInitials({ name: "Juwaya Al Riyadi" }), "JAR");
  assert.equal(teamInitials({ name: "Mabarrah" }), "MAB");
  assert.equal(teamInitials(null), "?");
});

test("date filter helpers keep the previous Sunday-first grid and no past dates", () => {
  const days = getCalendarDays(new Date(2026, 9, 1));
  assert.equal(days.length % 7, 0);
  assert.equal(days.slice(0, 4).every((day) => day === null), true);
  assert.equal(toDateInputValue(days[4]), "2026-10-01");
  assert.equal(isBeforeDay(new Date(2026, 9, 1), new Date(2026, 9, 2)), true);
  assert.equal(isBeforeDay(new Date(2026, 9, 2, 23), new Date(2026, 9, 2, 1)), false);
});
