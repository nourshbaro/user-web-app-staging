/**
 * The branded launch splash (v3). Pure module (no React Native imports).
 *
 * It is the app's launch presentation on EVERY launch: shown while startup
 * resolves, then removed. It is deliberately stateless — nothing is stored,
 * so it can never become "first-run only". First-run onboarding is separate
 * and keeps its own versioned flag (`ONBOARDING_STORAGE_KEY`).
 *
 * It never navigates or waits on navigation: a direct entry (deep link,
 * notification, auth or payment return) resolves beneath it unchanged.
 */

/** v3 `lfLogo .7s` + `lfWord .6s .25s`, then a short read. */
export const LAUNCH_SPLASH_MIN_MS = 1200;
/** Reduced motion: no animation to finish, only a brief brand beat. */
export const LAUNCH_SPLASH_REDUCED_MIN_MS = 500;

export function launchSplashMinimumMs(reducedMotion: boolean) {
  return reducedMotion ? LAUNCH_SPLASH_REDUCED_MIN_MS : LAUNCH_SPLASH_MIN_MS;
}

export type LaunchSplashInput = {
  /** The launch decision is made (the onboarding gate is no longer deciding). */
  bootstrapSettled: boolean;
  /** The minimum brand beat for this launch has elapsed. */
  minimumElapsed: boolean;
};

/** Hide once startup has settled AND the brand beat has played. */
export function shouldHideLaunchSplash({ bootstrapSettled, minimumElapsed }: LaunchSplashInput) {
  return bootstrapSettled && minimumElapsed;
}
