import { nextKickoffAfter } from "@/lib/matchDiscovery";
import type { ApiMatch } from "@/types";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

/** setTimeout's maximum delay (~24.8 days); longer waits re-arm in steps. */
const MAX_TIMER_DELAY = 2_147_483_647;

/**
 * Presentation time for kickoff-based views (e.g. Home's "Next match").
 *
 * Starts at `loadedAt` (when the data arrived) and advances only when it
 * matters: just after the next valid kickoff among the already-loaded
 * matches, and whenever the app returns to the foreground. No polling, no
 * global store, no network — callers re-derive their view from the same data.
 */
export function useKickoffClock(matches: readonly ApiMatch[], loadedAt: number) {
  const [tick, setTick] = useState(0);
  const now = Math.max(loadedAt, tick);
  const boundary = useMemo(() => nextKickoffAfter(matches, now), [matches, now]);

  useEffect(() => {
    if (boundary === null) return;
    // +250ms so the re-evaluation lands just after kickoff, not just before it.
    const delay = Math.min(Math.max(boundary - Date.now() + 250, 0), MAX_TIMER_DELAY);
    const timer = setTimeout(() => setTick(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [boundary, now]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setTick(Date.now());
    });
    return () => subscription.remove();
  }, []);

  return now;
}
