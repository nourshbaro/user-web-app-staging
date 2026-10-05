import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { groupMatchesByDate, matchDateStrip } from "../../lib/matchDiscovery.ts";
import { getSafeAuthReturnRoute } from "../../lib/authReturnRoute.ts";

// Batches 1–3 (v3 Home, Matches, navigation). Source contracts: no renderer in this node:test setup.
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const home = strip(await read("../HomeFeed.tsx"));
const list = strip(await read("../MatchesList.tsx"));
const filters = strip(await read("./MatchFilters.tsx"));

test("fixtures are grouped under their backend date, undated fixtures last and never re-dated", () => {
  const rows = [
    { id: 1, match_date: "2026-10-03" },
    { id: 2, match_date: "2026-10-04" },
    { id: 3, match_date: "not-a-date" },
    { id: 4, match_date: "2026-10-03" },
    { id: 5, match_date: "2026-02-30" },
  ];
  const groups = groupMatchesByDate(rows);
  assert.deepEqual(groups.map((group) => group.date), ["2026-10-03", "2026-10-04", null]);
  assert.deepEqual(groups[0].matches.map((row) => row.id), [1, 4]);
  assert.deepEqual(groups[2].matches.map((row) => row.id), [3, 5]);
  // Nothing dropped.
  assert.equal(groups.reduce((sum, group) => sum + group.matches.length, 0), rows.length);
});

test("the date strip is consecutive days from today and never hides the selected date", () => {
  const today = new Date(2026, 9, 30);
  const days = matchDateStrip(today, 4);
  assert.deepEqual(days, ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(matchDateStrip(today, 4, "2026-10-31"), days);
  assert.deepEqual(matchDateStrip(today, 2, "2026-12-25"), ["2026-12-25", "2026-10-30", "2026-10-31"]);
});

test("date chips drive the existing backend date filter through the synchronous invalidation path", () => {
  assert.match(list, /<MatchDateStrip\s+tab=\{tab\}\s+value=\{query\.date\}\s+datesWithFixtures=\{dotDates\}\s+onSelect=\{\(date\) => changeFilters\(\{ \.\.\.filters, date \}\)\}/);
  // Dots come only from real results for the tab (no extra request, no guessing).
  assert.match(list, /dates: datesWithMatches\(data\.matches\)/);
  assert.match(filters, /onPress=\{\(\) => onSelect\(day\)\}/);
  assert.match(filters, /onPress=\{\(\) => onSelect\(undefined\)\}/);
  // Selection state reaches assistive tech on web and native.
  assert.match(filters, /aria-selected=\{selected\}/);
  // No device-side filtering of the result set.
  assert.doesNotMatch(list, /matches\.filter\(|data\.matches\.filter\(/);
});

test("Matches tabs map to the confirmed backend statuses; no competition filter, nothing fabricated", async () => {
  const discovery = await read("../../lib/matchDiscovery.ts");
  // Upcoming = default scheduled list, Live = status=live, Results = status=completed.
  assert.match(discovery, /return tab === "live" \? "live" : tab === "results" \? "completed" : undefined;/);
  const service = await read("../../services/matches.ts");
  assert.match(service, /if \(filters\.status\) params\.set\("status", filters\.status\);/);
  // Status composes server-side; the list never filters rows on the device.
  assert.doesNotMatch(list, /matches\.filter\(|\.status === "live"|minute/);
  // No competition filter: /matches/scheduled has no such parameter.
  for (const source of [list, filters]) assert.doesNotMatch(source, /competition|compF/i);
  assert.match(list, /groupMatchesByDate\(matches\)/);
  assert.match(list, /heading=\{group\.date \? formatLongCalendarDate\(group\.date\) : t\("matches\.dateTbc"\)\}/);
});

test("Home renders only backend data through the existing owners (no fabricated live data)", async () => {
  // Live now / Latest result: the same scheduled-matches owner with the backend status filter.
  assert.match(home, /const LIVE_FILTERS: MatchFilters = \{ status: "live" \};/);
  assert.match(home, /const COMPLETED_FILTERS: MatchFilters = \{ status: "completed" \};/);
  assert.match(home, /const live = useScheduledMatches\(LIVE_FILTERS\);/);
  assert.match(home, /const completed = useScheduledMatches\(COMPLETED_FILTERS\);/);
  // Sections render only when the backend returned such matches.
  assert.match(home, /\{liveMatch \? \(/);
  assert.match(home, /\{latestResult \? \(/);
  // No direct requests from the screen; no minutes/events/statistics.
  assert.doesNotMatch(home, /apiRequest|profileService|matchesService|minute|statistic|timeline/i);
  // The My Tickets card: portal data via its owner hook, and a tab switch.
  assert.match(home, /const tickets = useNextTicketMatch\(\);/);
  const shortcut = home.slice(home.indexOf("function TicketsCard"));
  assert.match(shortcut, /onPress=\{\(\) => switchTab\("\/tickets"\)\}/);
  const owner = await read("../../hooks/useNextTicketMatch.ts");
  // Through the user-scoped cached read, which delegates to the portal service.
  assert.match(owner, /portalReads\s*\.matches\("upcoming", force\)/);
  const cachedReads = await read("../../services/cachedReads.ts");
  assert.match(cachedReads, /\(\) => profileService\.matches\(filter\)/);
  assert.match(owner, /const current = \(\) => request\.isCurrent\(ticket\) && generation === getUserScopedCacheGeneration\(\);/);
  assert.match(owner, /if \(!owner\) return;/);
  assert.match(home, /function switchTab\(route: PrimaryTabRoute\) \{\s*setPrimaryTabTransitionDirection\(1\);\s*router\.replace\(route\);/);
  // Upcoming rows reuse the same owner-selected list.
  assert.match(home, /upcoming\.map\(\(match, index\) => \(\s*<MatchCard key=\{match\.id\} match=\{match\} variant="dated"/);
});

test("the Competitions route exists alongside the legacy redirect in every allowlist", async () => {
  assert.equal(getSafeAuthReturnRoute("/competitions"), "/competitions");
  assert.equal(getSafeAuthReturnRoute("/tournament"), "/tournament");
  const ads = await read("../../lib/adUrls.ts");
  const internal = ads.slice(ads.indexOf("STATIC_INTERNAL_ROUTES"), ads.indexOf("]);"));
  assert.match(internal, /"\/competitions"/);
  assert.match(internal, /"\/tournament"/);
});

test("row press feedback is instant and reduced-motion aware", async () => {
  const feedback = await read("../foundation/pressFeedback.ts");
  assert.match(feedback, /return reducedMotion \? \{ opacity: 0\.86 \} : \{ transform: \[\{ scale: PRESSED_SCALE \}\] \};/);
  assert.doesNotMatch(feedback, /withTiming|Animated\.timing|setTimeout/);
});
