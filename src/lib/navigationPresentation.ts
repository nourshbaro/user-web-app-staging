export const PRIMARY_TAB_ROUTES = ["/", "/tournament", "/matches", "/tickets", "/profile"] as const;

export function shouldShowBottomNavigation(pathname: string) {
  return (PRIMARY_TAB_ROUTES as readonly string[]).includes(pathname);
}
