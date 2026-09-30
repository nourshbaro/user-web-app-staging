import { useReducedMotion } from "@/hooks/useReducedMotion";
import { launchSplashMinimumMs, shouldHideLaunchSplash } from "@/lib/launchSplash";
import { useCallback, useEffect, useState } from "react";

/**
 * Per-launch state of the branded launch splash. In memory only: every launch
 * starts with the splash showing; nothing is persisted, so it can never turn
 * into a first-run-only screen.
 */
export function useLaunchSplash(bootstrapSettled: boolean) {
  const reducedMotion = useReducedMotion();
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinimumElapsed(true), launchSplashMinimumMs(reducedMotion));
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  const onHidden = useCallback(() => setGone(true), []);

  return {
    visible: !gone,
    leaving: !gone && shouldHideLaunchSplash({ bootstrapSettled, minimumElapsed }),
    onHidden,
  };
}
