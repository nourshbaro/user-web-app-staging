import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLiveRevalidationSchedule, LIVE_REFRESH_INTERVAL_MS } from "./liveRevalidation.ts";
import { matchQueryFor, needsSeparateLiveProbe } from "./matchDiscovery.ts";

/** Deterministic fake interval timers: advance() fires whatever is due. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const intervals = new Map();
  return {
    timers: {
      setInterval(callback, ms) {
        const id = nextId++;
        intervals.set(id, { callback, ms, due: now + ms });
        return id;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...intervals.values()].filter((entry) => entry.due <= end).sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        now = next.due;
        next.due += next.ms;
        next.callback();
      }
      now = end;
    },
    active: () => intervals.size,
  };
}

function setup(intervalEnabled = false) {
  const clock = fakeTimers();
  let calls = 0;
  const schedule = createLiveRevalidationSchedule({ revalidate: () => { calls += 1; }, intervalEnabled, timers: clock.timers });
  return { clock, schedule, calls: () => calls };
}

test("a restrained 30s Live interval", () => {
  assert.equal(LIVE_REFRESH_INTERVAL_MS, 30_000);
});

test("first focus does not duplicate the initial load; re-focus revalidates", () => {
  const { schedule, calls } = setup();
  schedule.focus();
  assert.equal(calls(), 0);
  schedule.blur();
  schedule.focus();
  assert.equal(calls(), 1);
});

test("returning to the foreground revalidates only while focused", () => {
  const { schedule, calls } = setup();
  schedule.focus();
  schedule.appStateChange("background");
  schedule.appStateChange("active");
  assert.equal(calls(), 1);
  schedule.blur();
  schedule.appStateChange("background");
  schedule.appStateChange("active");
  assert.equal(calls(), 1, "an unfocused screen does not revalidate");
});

test("the interval runs only while focused, foregrounded AND enabled (Live visible)", () => {
  const { clock, schedule, calls } = setup(true);
  clock.advance(90_000);
  assert.equal(calls(), 0, "nothing before focus");
  schedule.focus();
  assert.equal(schedule.isPolling(), true);
  clock.advance(90_000);
  assert.equal(calls(), 3);
  // Backgrounded: stops; resumes (with one catch-up read) on return.
  schedule.appStateChange("background");
  assert.equal(schedule.isPolling(), false);
  clock.advance(120_000);
  assert.equal(calls(), 3);
  schedule.appStateChange("active");
  assert.equal(calls(), 4);
  assert.equal(schedule.isPolling(), true);
  // Leaving the Live tab stops it; returning restarts it.
  schedule.setIntervalEnabled(false);
  clock.advance(120_000);
  assert.equal(calls(), 4);
  schedule.setIntervalEnabled(true);
  clock.advance(30_000);
  assert.equal(calls(), 5);
  // Blur and dispose stop it for good; no stray timers.
  schedule.blur();
  assert.equal(clock.active(), 0);
  schedule.focus();
  schedule.dispose();
  assert.equal(clock.active(), 0);
});

test("without the interval (Home, the dot probe) there is no polling at all", () => {
  const { clock, schedule, calls } = setup(false);
  schedule.focus();
  clock.advance(10 * 60_000);
  assert.equal(calls(), 0);
  assert.equal(clock.active(), 0);
});

test("the Live probe is a separate request only when it differs from the visible query", () => {
  assert.equal(needsSeparateLiveProbe("live", matchQueryFor({}, "live")), false, "unfiltered Live answers it");
  assert.equal(needsSeparateLiveProbe("live", matchQueryFor({ team: "ansar" }, "live")), true);
  assert.equal(needsSeparateLiveProbe("live", matchQueryFor({ date: "2026-09-29" }, "live")), true);
  assert.equal(needsSeparateLiveProbe("upcoming", matchQueryFor({}, "upcoming")), true);
  assert.equal(needsSeparateLiveProbe("results", matchQueryFor({}, "results")), true);
});

test("Matches wires one forced Live request per pull, polling only on the Live tab", async () => {
  const list = await readFile(new URL("../components/MatchesList.tsx", import.meta.url), "utf8");
  assert.match(list, /const liveProbe = useScheduledMatches\(LIVE_PROBE, \{ enabled: liveProbeNeeded \}\);/);
  assert.match(list, /const liveAvailable = liveProbeNeeded \? liveProbe\.matches\.length > 0 : matches\.length > 0;/);
  assert.match(list, /data\.refresh\(\);\s*if \(liveProbeNeeded\) liveProbe\.refresh\(\);/);
  assert.match(list, /useLiveRevalidation\(liveSelected \? data\.revalidate : NO_REVALIDATION, \{ poll: liveSelected \}\);/);
  const home = await readFile(new URL("../components/HomeFeed.tsx", import.meta.url), "utf8");
  assert.match(home, /useLiveRevalidation\(live\.revalidate\);/);
  assert.doesNotMatch(home, /poll: true/);
});

test("disabled owner instances never request; revalidation is silent and goes through the owner", async () => {
  const hook = await readFile(new URL("../hooks/useScheduledMatches.ts", import.meta.url), "utf8");
  assert.match(hook, /useEffect\(\(\) => \{\s*if \(!enabled\) return;\s*const timeout = setTimeout\(\(\) => void load\(\), 0\);/);
  assert.match(hook, /const refresh = useCallback\(\(\) => \{[\s\S]*?if \(!enabled\) return;\s*setRefreshing\(true\);/);
  // Background revalidation: a forced load without the refreshing/loading indicators.
  assert.match(hook, /const revalidate = useCallback\(\(\) => \{\s*if \(enabled\) void load\(true\);\s*\}, \[enabled, load\]\);/);
  assert.match(hook, /if \(!forceRefresh\) setLoadingFlag\(true\);/);
});
