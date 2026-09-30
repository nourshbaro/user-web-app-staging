import { createLiveRevalidationSchedule, LIVE_REFRESH_INTERVAL_MS, type LiveRevalidationSchedule } from "@/lib/liveRevalidation";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/**
 * Screen-scoped Live freshness (see `liveRevalidation.ts`): re-reads on
 * re-focus and on return to the foreground, and — while `poll` is true — every
 * 30s while the screen is focused and the app is active. `revalidate` is the
 * owner's own background reload (`useScheduledMatches().revalidate`), so cache,
 * request authority and error handling stay with that owner.
 */
export function useLiveRevalidation(revalidate: () => void, { poll = false }: { poll?: boolean } = {}) {
  // Always call the latest owner callback from the long-lived schedule.
  const revalidateRef = useRef(revalidate);
  useEffect(() => {
    revalidateRef.current = revalidate;
  }, [revalidate]);

  const [schedule] = useState<LiveRevalidationSchedule>(() =>
    createLiveRevalidationSchedule({
      revalidate: () => revalidateRef.current(),
      intervalMs: LIVE_REFRESH_INTERVAL_MS,
      intervalEnabled: false,
      timers: { setInterval: (callback, ms) => setInterval(callback, ms), clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) },
    }),
  );

  useFocusEffect(
    useCallback(() => {
      schedule.focus();
      return () => schedule.blur();
    }, [schedule]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => schedule.appStateChange(state));
    return () => subscription.remove();
  }, [schedule]);

  useEffect(() => {
    schedule.setIntervalEnabled(poll);
  }, [poll, schedule]);

  useEffect(() => () => schedule.dispose(), [schedule]);
}
