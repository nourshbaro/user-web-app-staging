/** Primary tabs in reading order. `/tournament` is a compatibility redirect to `/competitions`. */
export const PRIMARY_TAB_ROUTES = ["/", "/matches", "/tickets", "/competitions", "/profile"] as const;

export type PrimaryTabRoute = (typeof PRIMARY_TAB_ROUTES)[number];
let primaryTabTransitionDirection: -1 | 1 = 1;

export function setPrimaryTabTransitionDirection(direction: -1 | 1) {
  primaryTabTransitionDirection = direction;
}

export function getPrimaryTabTransitionDirection() {
  return primaryTabTransitionDirection;
}

export function adjacentPrimaryTab(pathname: string, direction: -1 | 1) {
  const current = PRIMARY_TAB_ROUTES.indexOf(pathname as PrimaryTabRoute);
  if (current < 0) return null;
  return PRIMARY_TAB_ROUTES[current + direction] ?? null;
}

export function shouldShowBottomNavigation(pathname: string) {
  return (PRIMARY_TAB_ROUTES as readonly string[]).includes(pathname);
}

/**
 * Swipe → tab step. Primary tabs are laid out in reading order, so a swipe
 * toward the reading start reveals the next tab: leftward in LTR, rightward
 * in RTL (where React Native mirrors the tab row).
 */
export function swipeTabStep(translationX: number, isRTL: boolean): -1 | 1 {
  const leftward = translationX < 0;
  return leftward !== isRTL ? 1 : -1;
}

/** Entrance offset (px) for a tab transition; mirrored in RTL so content arrives from the matching side. */
export function tabEntranceOffset(direction: -1 | 1, isRTL: boolean, distance = 10) {
  return distance * direction * (isRTL ? -1 : 1);
}
