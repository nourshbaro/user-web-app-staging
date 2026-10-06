import { useAuth } from "@/context/AuthContext";
import { createRequestAuthority } from "@/lib/requestAuthority";
import { getUserScopedCacheGeneration, onUserScopedCacheInvalidated } from "@/lib/userScopedCache";
import { notificationReads, onNotificationsInvalidated } from "@/services/cachedReads";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * The Home bell's unread number: `GET /portal/notifications/unread-count`
 * through the identity-scoped portal cache (`notificationReads`). Only a
 * backend count is ever shown — it is never lowered locally (the API has no
 * mark-read), never shown for another identity, and a failure keeps the last
 * backend count rather than inventing 0.
 *
 * Re-read when: the screen mounts (served from a fresh entry when there is
 * one), the app returns to the foreground (same freshness rule), a push is
 * received or opened (`invalidateNotifications`), and on pull-to-refresh
 * (`reload`, forced). No polling.
 */
export function useUnreadNotificationCount() {
  const auth = useAuth();
  const signedIn = auth.isReady && auth.isAuthenticated;
  const owner = signedIn ? auth.userCacheKey ?? "authenticated" : null;
  const [request] = useState(createRequestAuthority);
  const [count, setCount] = useState<number | null>(() => (auth.isAuthenticated ? notificationReads.peekUnreadCount()?.value ?? null : null));

  const load = useCallback((force = false) => {
    if (!owner) return;
    const ticket = request.begin(owner);
    const generation = getUserScopedCacheGeneration();
    const current = () => request.isCurrent(ticket) && generation === getUserScopedCacheGeneration();
    return notificationReads
      .unreadCount(force)
      .then((next) => {
        if (current()) setCount(next);
      })
      .catch(() => {
        // Keep the last backend count; a failed read is not "no notifications".
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

  // Logout / account switch: never keep the previous identity's number.
  useEffect(() => onUserScopedCacheInvalidated(() => {
    request.invalidate();
    setCount(null);
  }), [request]);

  useEffect(() => onNotificationsInvalidated(() => void load()), [load]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);

  // Pull-to-refresh: a forced read.
  const reload = useCallback(() => load(true), [load]);

  return { count: owner ? count : null, reload };
}
