/**
 * Native layout-direction lifecycle (pure module, unit-tested).
 *
 * React Native fixes the layout direction (`I18nManager.isRTL`) when the app
 * process/JS runtime starts; `forceRTL` only takes effect after a reload.
 * So the *desired* direction (from the app language) and the *active* native
 * direction can differ for one launch. The app must not render normal content
 * during that window, and must never reload in a loop.
 *
 * Loop prevention: before an automatic reload, a marker recording the desired
 * direction and the attempt count is persisted. A mismatch that survives
 * MAX_AUTOMATIC_RELOADS attempts becomes a blocking "restart required" state
 * with no further automatic reloads (a full cold start applies the setting).
 */

export type Direction = "ltr" | "rtl";

export type DirectionAttempt = { desired: Direction; attempts: number };

export const DIRECTION_ATTEMPT_STORAGE_KEY = "lfa_direction_transition";
export const MAX_AUTOMATIC_RELOADS = 1;

export type DirectionPlan =
  /** Active matches desired: render normally. Clear any stale marker. */
  | { phase: "ready"; clearAttempt: boolean }
  /** Apply the native direction, persist `attempt`, then reload once. */
  | { phase: "apply-and-reload"; attempt: DirectionAttempt }
  /** Automatic reload already tried: block with a restart-required state. */
  | { phase: "restart-required" };

export function planDirection({
  desired,
  active,
  attempt,
}: {
  desired: Direction;
  active: Direction;
  attempt: DirectionAttempt | null;
}): DirectionPlan {
  if (desired === active) return { phase: "ready", clearAttempt: attempt !== null };

  // A marker for a different desired direction (e.g. the language changed
  // again) does not count against this transition.
  const priorAttempts = attempt?.desired === desired ? attempt.attempts : 0;
  if (priorAttempts >= MAX_AUTOMATIC_RELOADS) return { phase: "restart-required" };

  return { phase: "apply-and-reload", attempt: { desired, attempts: priorAttempts + 1 } };
}

export function parseDirectionAttempt(raw: string | null): DirectionAttempt | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" && value !== null &&
      ((value as DirectionAttempt).desired === "ltr" || (value as DirectionAttempt).desired === "rtl") &&
      Number.isInteger((value as DirectionAttempt).attempts) &&
      (value as DirectionAttempt).attempts >= 0
    ) {
      return { desired: (value as DirectionAttempt).desired, attempts: (value as DirectionAttempt).attempts };
    }
  } catch {
    // Malformed marker: treat as absent.
  }
  return null;
}

export function serializeDirectionAttempt(attempt: DirectionAttempt) {
  return JSON.stringify(attempt);
}
