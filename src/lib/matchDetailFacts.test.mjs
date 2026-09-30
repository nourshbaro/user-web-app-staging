import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { matchDetailFacts } from "./matchDetailFacts.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// Trimmed from the confirmed staging response of GET /api/matches/single/14 (2026-09-30).
const live = {
  id: 14,
  match_date: "2026-09-30",
  kickoff_at: "08:15:00",
  status: "live",
  home_team: { id: 5, name: "Al Safa", logo: "teams/logos/home.png" },
  away_team: { id: 3, name: "Juwaya Al Riyadi", logo: "teams/logos/away.png" },
  competition: { id: 3, name: "this is a test", short_name: "TIAT", slug: "this-is-a-test", logo: "competitions/logos/c.png" },
  season: { id: 3, label: "26-2027", is_current: true },
  matchday: 1,
  round_name: null,
  matchday_label: "Matchday 1",
  home_score: 1,
  away_score: 0,
  clock: { minute: null, running: false },
  events: [],
  stats: {
    possession: null,
    shots: { home: null, away: null },
    shots_on_target: { home: null, away: null },
    corners: { home: null, away: null },
    fouls: { home: null, away: null },
  },
  stadium: { id: 9, name: "Fouad Chehab Stadium", location: "Jounieh, Lebanon", map_image: "stadiums/maps/m.svg", zones: [] },
};

test("single-match facts keep the backend's competition, season, matchday and scores", () => {
  const facts = matchDetailFacts(live);
  assert.equal(facts.competitionName, "this is a test");
  assert.equal(facts.competitionLogo, "competitions/logos/c.png");
  assert.equal(facts.seasonLabel, "26-2027");
  assert.equal(facts.roundLabel, "Matchday 1");
  assert.deepEqual(facts.score, { home: 1, away: 0 });
  assert.equal(facts.clockRunning, false);
});

test("a null live minute, empty events and null statistics are never fabricated", () => {
  const facts = matchDetailFacts(live);
  assert.equal(facts.liveMinute, null, "minute: null is not a live minute");
  assert.deepEqual(facts.events, [], "no timeline events");
  assert.deepEqual(facts.stats, [], "null statistics are omitted, never zero");
  // Only supplied sides are kept; the missing side stays null.
  const partial = matchDetailFacts({ ...live, clock: { minute: 63, running: true }, stats: { corners: { home: 4, away: null }, fouls: { home: 0, away: 2 } } });
  assert.equal(partial.liveMinute, 63);
  assert.deepEqual(partial.stats, [
    { key: "corners", home: 4, away: null },
    { key: "fouls", home: 0, away: 2 },
  ]);
});

test("missing or partial fields degrade to null, never to invented values", () => {
  const bare = matchDetailFacts({ id: 1, match_date: "2026-10-01", kickoff_at: "18:00:00", status: "scheduled", home_team: live.home_team, away_team: live.away_team, home_score: null, away_score: 2 });
  assert.equal(bare.competitionName, null);
  assert.equal(bare.roundLabel, null);
  assert.equal(bare.score, null, "a score needs both backend values");
  assert.equal(bare.liveMinute, null);
  assert.equal(bare.clockRunning, null);
  assert.deepEqual(bare.events, []);
  assert.deepEqual(bare.stats, []);
  // round_name is used only when no matchday_label exists; a bare number is never composed into a label.
  assert.equal(matchDetailFacts({ ...live, matchday_label: null, round_name: "Final" }).roundLabel, "Final");
  assert.equal(matchDetailFacts({ ...live, matchday_label: null, round_name: null, matchday: 4 }).roundLabel, null);
});

test("scores and the live minute belong to the live/result view; the scheduled hero shows kickoff only", async () => {
  const hero = await read("../components/match/MatchDetailHero.tsx");
  const view = await read("../components/match/MatchInfoView.tsx");
  assert.match(hero, /const facts = matchDetailFacts\(match\);/);
  assert.doesNotMatch(hero, /facts\.(score|homeScore|awayScore|liveMinute)/);
  assert.match(hero, /<PitchArt \/>/);
  // The info view: each score side separately (null shown as unavailable), minute only when supplied.
  assert.match(view, /const scoreText = \(value: number \| null\) => \(value === null \? "–" : String\(value\)\);/);
  assert.match(view, /facts\.liveMinute !== null\s*\? i18n\.t\("matchInfo\.live\.minute"/);
  assert.match(view, /<LiveDot running=\{facts\.clockRunning === true\} \/>/);
  assert.doesNotMatch(view, /setInterval|Date\.now|new Date/, "no client-side match clock");
  // Geometry, zones and cart behaviour are untouched by the contract change.
  const service = await read("../services/matches.ts");
  assert.match(service, /apiRequest<ApiMatchDetail \| \{ data: ApiMatchDetail \}>\(path\)/);
  // The list and single-match live shapes stay distinct.
  const types = await read("../types.ts");
  assert.match(types, /clock_minute\?: number \| null;/);
  assert.match(types, /clock\?: ApiMatchClock \| null;/);
});
