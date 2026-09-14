export const PRIMARY_TAB_ROUTES = ["/", "/tournament", "/matches", "/tickets", "/profile"] as const;

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
