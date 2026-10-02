/**
 * v3 completed-match motion, as configuration (pure module, unit-tested).
 *
 * Stats (v3 \`lfBar .7s (120 + i·50)ms EO both\`): only the share bars move.
 * Each bar grows from the centre line outward (the home bar from its inner
 * edge, the away bar from its inner edge); values and labels are shown in
 * their final, real state from the first frame — nothing counts up, and a
 * missing statistic has no bar. It plays whenever Stats is shown (initial
 * display and every switch back). Under reduced motion there is no
 * animation: the bars render at their final width.
 *
 * Timeline (v3 \`lfEnter .36s (60 + i·35)ms\`) rows rise in; Stats rows do not.
 */
export const EASE_OUT_V3 = [0.22, 1, 0.36, 1] as const;

export type StatBarMotion = { duration: number; delay: number; easing: typeof EASE_OUT_V3 };

export function statBarMotion(index: number, reducedMotion: boolean): StatBarMotion | null {
  if (reducedMotion) return null;
  return { duration: 700, delay: 120 + Math.max(0, index) * 50, easing: EASE_OUT_V3 };
}

/** The physical edge a bar grows from: the centre of the pair, mirrored in RTL. */
export function statBarOrigin(side: "home" | "away", isRTL: boolean): "left" | "right" {
  const inner = side === "home" ? "right" : "left";
  if (!isRTL) return inner;
  return inner === "right" ? "left" : "right";
}

export type TimelineRowMotion = { duration: number; delay: number };

export function timelineRowMotion(index: number, reducedMotion: boolean): TimelineRowMotion | null {
  if (reducedMotion) return null;
  return { duration: 360, delay: 60 + Math.min(Math.max(0, index), 10) * 35 };
}
