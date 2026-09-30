/**
 * First-run onboarding decisions. Pure module (no React Native imports).
 *
 * Onboarding is presentation plus one local preference: a versioned "seen"
 * flag. It owns no navigation. It is offered only when the app was opened
 * normally at Home, so it can never trap or redirect an entry that points
 * somewhere specific (deep links, auth returns, payment results, notification
 * taps): those skip it for that launch.
 *
 * Launch readiness. On a native cold start the router can report "/" before
 * the initial link is resolved (Expo Router's default route info while the
 * Android initial URL is still pending), and a notification that launched the
 * app is only routed after mount. So the decision never uses that early
 * pathname: it waits for the navigation container to be ready with its
 * resolved initial state, reads the focused route from it, and also resolves
 * the launch notification before anything becomes visible.
 */

/** Bump the version to show a materially new onboarding once more. */
export const ONBOARDING_STORAGE_KEY = "lfa_onboarding_v1";

const COMPLETED_VALUE = "completed";

export function serializeOnboardingCompleted() {
  return COMPLETED_VALUE;
}

export function isOnboardingCompleted(stored: string | null) {
  return stored === COMPLETED_VALUE;
}

/** Expo Router's route name for Home (`src/app/index.tsx`). */
const HOME_ROUTE_NAME = "index";

export function isHomeRouteName(name: string | null | undefined) {
  return name === HOME_ROUTE_NAME;
}

export type OnboardingDecisionInput = {
  platform: string;
  /** Raw stored flag (`null` when never written). */
  storedFlag: string | null;
  /** A restored signed-in session proves this is an existing user. */
  isAuthenticated: boolean;
  /** The RESOLVED initial destination is Home (never an unresolved/default pathname). */
  initialRouteIsHome: boolean;
};

export type OnboardingSkipReason = "web" | "completed" | "existing-user" | "direct-entry" | "unresolved";

export type OnboardingDecision =
  | { show: true }
  | { show: false; reason: OnboardingSkipReason };

/**
 * - Native only: on the web there is no install, splash or native permission prompt.
 * - Once completed, never again (versioned flag).
 * - Signed-in users are existing users: they are never sent through it.
 * - Only a launch whose resolved destination is Home; any other entry skips it for this launch.
 */
export function decideOnboarding({ platform, storedFlag, isAuthenticated, initialRouteIsHome }: OnboardingDecisionInput): OnboardingDecision {
  if (!isNativePlatform(platform)) return { show: false, reason: "web" };
  if (isOnboardingCompleted(storedFlag)) return { show: false, reason: "completed" };
  if (isAuthenticated) return { show: false, reason: "existing-user" };
  if (!initialRouteIsHome) return { show: false, reason: "direct-entry" };
  return { show: true };
}

export function isNativePlatform(platform: string) {
  return platform === "ios" || platform === "android";
}

/** The subset of the navigation container ref the launch check reads (never navigates). */
export type LaunchNavigationRef = {
  isReady(): boolean;
  addListener(event: "ready", callback: () => void): () => void;
  getCurrentRoute(): { name: string } | undefined;
};

/**
 * Resolves with the focused route name once the navigation container is ready,
 * i.e. once it has mounted its resolved initial state (deep links included).
 * Nothing is read before that point, so a default "/" can never be mistaken
 * for a Home launch. The listener is attached before checking readiness, so
 * the ready event cannot be missed.
 */
export function resolvedInitialRouteName(ref: LaunchNavigationRef): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve(ref.getCurrentRoute()?.name ?? null);
    };
    unsubscribe = ref.addListener("ready", settle);
    if (settled) unsubscribe();
    else if (ref.isReady()) settle();
  });
}

export type LaunchCheckDependencies = {
  platform: string;
  isAuthenticated: boolean;
  pushRuntimeSupported: boolean;
  readStoredFlag: () => Promise<string | null>;
  navigation: LaunchNavigationRef;
  /**
   * Where the notification that launched the app will route (e.g. its match
   * id), or null. Read-only: routing stays with the notification owner.
   */
  readLaunchNotificationTarget: () => Promise<string | null>;
  readPermission: () => Promise<"granted" | "denied" | "undetermined">;
};

export type LaunchOnboardingDecision =
  | { show: true; offerNotifications: boolean }
  | { show: false; reason: OnboardingSkipReason | "unreadable" };

/**
 * The whole launch check, in order. It returns ONE final decision; the caller
 * shows onboarding only on `{ show: true }`, so it is never visible while any
 * launch intent is still unknown. Failures never trap the app: they skip
 * onboarding for this launch without marking it completed.
 */
export async function decideLaunchOnboarding(deps: LaunchCheckDependencies): Promise<LaunchOnboardingDecision> {
  if (!isNativePlatform(deps.platform)) return { show: false, reason: "web" };

  let storedFlag: string | null;
  try {
    storedFlag = await deps.readStoredFlag();
  } catch {
    return { show: false, reason: "unreadable" };
  }
  if (isOnboardingCompleted(storedFlag)) return { show: false, reason: "completed" };
  if (deps.isAuthenticated) return { show: false, reason: "existing-user" };

  // 1. The resolved initial destination (URL-based entries: deep links, auth
  //    and payment returns, /match/[id], …).
  const initialRoute = await resolvedInitialRouteName(deps.navigation);
  const decision = decideOnboarding({
    platform: deps.platform,
    storedFlag,
    isAuthenticated: deps.isAuthenticated,
    initialRouteIsHome: isHomeRouteName(initialRoute),
  });
  if (!decision.show) return decision;

  // 2. A notification that launched the app is routed after mount; if it
  //    targets a match, this launch is a direct entry.
  let launchTarget: string | null;
  try {
    launchTarget = await deps.readLaunchNotificationTarget();
  } catch {
    return { show: false, reason: "unresolved" };
  }
  if (launchTarget) return { show: false, reason: "direct-entry" };

  let permission: "granted" | "denied" | "undetermined" | null = null;
  try {
    permission = await deps.readPermission();
  } catch {
    // Unknown permission: skip the pre-prompt rather than prompt blindly.
  }

  // 3. Still on Home now? (Anything may have navigated while this resolved.)
  if (!isHomeRouteName(deps.navigation.getCurrentRoute()?.name)) {
    return { show: false, reason: "direct-entry" };
  }
  return { show: true, offerNotifications: permission !== null && shouldOfferNotificationStep(permission, deps.pushRuntimeSupported) };
}

/**
 * While onboarding is visible, navigation away from Home (a notification tap,
 * a link) wins: onboarding steps aside for this launch without being marked
 * completed, so it is offered again on a later normal launch.
 */
export function shouldYieldToNavigation(pathname: string) {
  return pathname !== "/";
}

/**
 * First-run steps (v3). The branded splash is NOT a step: it is the launch
 * splash shown on every launch (`src/lib/launchSplash.ts`), never persisted.
 */
export type OnboardingStep = "intro" | "notifications";

export const INTRO_PAGE_COUNT = 3;

/**
 * The v3 notification pre-prompt is part of the first-run sequence whenever
 * the build has a push runtime. It used to require an "undetermined"
 * permission, which silently skipped it on any device whose OS had already
 * decided (Android 12 and below grant at install; earlier builds prompted at
 * startup). The permission state now only decides what "Turn on" does
 * (`shouldRequestPermissionOnTurnOn`), never whether the step appears.
 */
export function shouldOfferNotificationStep(_permission: "granted" | "denied" | "undetermined", pushRuntimeSupported: boolean) {
  return pushRuntimeSupported;
}

/** "Turn on notifications" asks the OS only when permission is not already granted. */
export function shouldRequestPermissionOnTurnOn(permission: "granted" | "denied" | "undetermined") {
  return permission !== "granted";
}

/**
 * First-run order: intro → notification pre-prompt (when offered) → done
 * (Home). There is no authentication step: sign-in stays in the normal
 * app / Profile journey.
 */
export function nextOnboardingStep(step: OnboardingStep, offerNotifications: boolean): OnboardingStep | "done" {
  if (step === "intro") return offerNotifications ? "notifications" : "done";
  return "done";
}
