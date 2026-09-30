/**
 * Bounded freshness for Live match data. Pure module (timers injected), so the
 * lifecycle is unit-tested deterministically.
 *
 * The API has no push or streaming for live matches, so the app re-reads them:
 * - when the screen regains focus (not on first focus: the screen's initial
 *   load is already in flight);
 * - when the app returns to the foreground while the screen is focused;
 * - optionally every `intervalMs` while the screen is focused AND the app is
 *   active — only where Live data is actually on screen (the Matches Live
 *   tab). The interval stops as soon as either condition ends.
 * There is no global poller: each schedule lives only as long as its screen.
 */

/** Live tab refresh period: restrained (not real-time), 10x under the 5-min cache TTL. */
export const LIVE_REFRESH_INTERVAL_MS = 30_000;

type Timers = {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type LiveRevalidationSchedule = {
  focus(): void;
  blur(): void;
  appStateChange(state: string): void;
  /** Turn the interval on/off (e.g. the Live tab becomes visible / hidden). */
  setIntervalEnabled(enabled: boolean): void;
  dispose(): void;
  /** For tests: whether the interval is currently running. */
  isPolling(): boolean;
};

export function createLiveRevalidationSchedule({
  revalidate,
  intervalMs = LIVE_REFRESH_INTERVAL_MS,
  intervalEnabled = false,
  timers,
}: {
  revalidate: () => void;
  intervalMs?: number;
  intervalEnabled?: boolean;
  timers: Timers;
}): LiveRevalidationSchedule {
  let focused = false;
  let focusedBefore = false;
  let active = true;
  let wantInterval = intervalEnabled;
  let handle: unknown = null;

  const sync = () => {
    const shouldPoll = focused && active && wantInterval;
    if (shouldPoll && handle === null) {
      handle = timers.setInterval(revalidate, intervalMs);
    } else if (!shouldPoll && handle !== null) {
      timers.clearInterval(handle);
      handle = null;
    }
  };

  return {
    focus() {
      if (focused) return;
      focused = true;
      if (focusedBefore && active) revalidate();
      focusedBefore = true;
      sync();
    },
    blur() {
      focused = false;
      sync();
    },
    appStateChange(state) {
      const nowActive = state === "active";
      if (nowActive && !active && focused) revalidate();
      active = nowActive;
      sync();
    },
    setIntervalEnabled(enabled) {
      wantInterval = enabled;
      sync();
    },
    dispose() {
      focused = false;
      wantInterval = false;
      sync();
    },
    isPolling: () => handle !== null,
  };
}
