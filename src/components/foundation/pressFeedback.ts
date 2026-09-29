import { useReducedMotion } from "@/hooks/useReducedMotion";
import { PRESSED_SCALE } from "@/lib/designTokens";
import { useCallback } from "react";

/**
 * Press feedback for cards and rows: a slight scale-down while pressed, or an
 * opacity change when the OS asks for reduced motion. Instant (no timing), so
 * it never delays the press action.
 */
export function usePressFeedback() {
  const reducedMotion = useReducedMotion();
  return useCallback(
    (pressed: boolean) => {
      if (!pressed) return null;
      return reducedMotion ? { opacity: 0.86 } : { transform: [{ scale: PRESSED_SCALE }] };
    },
    [reducedMotion],
  );
}
