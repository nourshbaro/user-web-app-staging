import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Tracks the platform's "reduce motion" accessibility preference so
 * decorative animation (expand/collapse, transitions) can be skipped for
 * users who asked the OS to minimize it.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (active) setReduced(Boolean(value));
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (value) => {
      setReduced(Boolean(value));
    });

    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}
