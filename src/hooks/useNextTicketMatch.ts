import { useAuth } from "@/context/AuthContext";
import { selectNextTicketMatch } from "@/lib/homeTickets";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { getUserScopedCacheGeneration, onUserScopedCacheInvalidated } from "@/lib/userScopedCache";
import { profileService } from "@/services/auth";
import type { PortalMatch } from "@/types";
import { useCallback, useEffect, useState } from "react";

export type NextTicketMatch =
  | { status: "signedOut" }
  | { status: "loading" }
  | { status: "ready"; match: PortalMatch | null }
  | { status: "error" };

/**
 * Screen-level loader for Home's "My Tickets" card: the signed-in user's next
 * match with tickets, through the existing portal service (`profileService`,
 * `apiRequest`). Same staleness guards as the Tickets screen: a request
 * authority per load plus the user-scoped cache generation, so an identity
 * change can never publish another account's tickets. Signed out: nothing is
 * requested.
 */
export function useNextTicketMatch() {
  const auth = useAuth();
  const [request] = useState(createRequestAuthority);
  const [state, setState] = useState<NextTicketMatch>({ status: "loading" });
  const signedIn = auth.isReady && auth.isAuthenticated;
  const owner = signedIn ? auth.userCacheKey ?? "authenticated" : null;

  const load = useCallback(() => {
    if (!owner) return;
    const ticket = request.begin(owner);
    const generation = getUserScopedCacheGeneration();
    const current = () => request.isCurrent(ticket) && generation === getUserScopedCacheGeneration();
    return profileService
      .matches("upcoming")
      .then((result) => {
        if (current()) setState({ status: "ready", match: selectNextTicketMatch(result.items) });
      })
      .catch(() => {
        if (current()) setState({ status: "error" });
      });
  }, [owner, request]);

  useEffect(() => {
    request.mount();
    return () => request.unmount();
  }, [request]);

  useEffect(() => {
    void load();
    return () => request.invalidate();
  }, [load, request]);

  // Logout / account switch: drop whatever was shown for the previous identity.
  useEffect(() => onUserScopedCacheInvalidated(() => {
    request.invalidate();
    setState({ status: "loading" });
  }), [request]);

  return { state: owner ? state : ({ status: "signedOut" } as const), reload: load };
}
