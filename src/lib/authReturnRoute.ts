const STATIC_AUTH_RETURN_ROUTES = new Set([
  "/",
  "/matches",
  "/competitions",
  // Legacy primary route: still accepted, it redirects to /competitions.
  "/tournament",
  "/tickets",
  "/profile",
  "/cart",
  "/checkout",
  "/checkout/ticket-holders",
  "/settings",
  "/about",
  "/edit-profile",
  "/notifications",
  // Deliberately absent: /change-password and /delete-account. A sign-in never
  // returns straight into an account-security step.
]);

export function getSafeAuthReturnRoute(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  if (STATIC_AUTH_RETURN_ROUTES.has(candidate)) return candidate;
  if (/^\/match\/[A-Za-z0-9_-]+$/.test(candidate)) return candidate;
  return null;
}
