import { router } from "expo-router";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "react-native";
import { authService } from "@/services/auth";
import { getToken, onUnauthenticated } from "@/services/api";
import { clearUserScopedCaches } from "@/lib/userScopedCache";
import type { User } from "@/types";

type AuthContextValue = {
  user: User | null;
  userCacheKey: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isReady, setReady] = useState(false);
  const userCacheKeyRef = useRef<string | null>(null);

  const applySession = useCallback((nextToken: string | null, nextUser: User | null) => {
    const nextUserCacheKey = nextToken ? userCacheKey(nextUser) : null;
    if (userCacheKeyRef.current !== nextUserCacheKey) {
      clearUserScopedCaches();
    }
    userCacheKeyRef.current = nextUserCacheKey;
    setTokenState(nextToken);
    setUser(nextUser);
  }, []);

  const clearSessionState = useCallback(() => {
    clearUserScopedCaches();
    userCacheKeyRef.current = null;
    setUser(null);
    setTokenState(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const [storedToken, storedUser] = await Promise.all([getToken(), authService.currentUser()]);
      applySession(storedToken, storedUser);
    } finally {
      setReady(true);
    }
  }, [applySession]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    return onUnauthenticated(() => {
      Keyboard.dismiss();
      clearSessionState();
      void authService.clearSession();
      const resetRouter = router as typeof router & { dismissAll?: () => void };
      resetRouter.dismissAll?.();
      router.replace("/");
    });
  }, [clearSessionState]);

  const logout = useCallback(async () => {
    clearSessionState();
    await authService.logout();
  }, [clearSessionState]);

  const value = useMemo(() => ({
    user,
    userCacheKey: token ? userCacheKey(user) : null,
    isAuthenticated: Boolean(token),
    isReady,
    refreshAuth,
    logout,
  }), [isReady, logout, refreshAuth, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

function userCacheKey(user: User | null) {
  if (typeof user?.id === "number" && Number.isFinite(user.id)) {
    return `id:${user.id}`;
  }
  const email = user?.email?.trim().toLowerCase();
  return email ? `email:${email}` : null;
}
