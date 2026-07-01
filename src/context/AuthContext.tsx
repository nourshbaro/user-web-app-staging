import { router } from "expo-router";
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { Keyboard } from "react-native";
import { authService } from "@/services/auth";
import { getToken, onUnauthenticated } from "@/services/api";
import type { User } from "@/types";

type AuthContextValue = {
  user: User | null;
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

  const refreshAuth = async () => {
    const [storedToken, storedUser] = await Promise.all([getToken(), authService.currentUser()]);
    setTokenState(storedToken);
    setUser(storedUser);
    setReady(true);
  };

  useEffect(() => {
    void refreshAuth();
  }, []);

  useEffect(() => {
    return onUnauthenticated(() => {
      Keyboard.dismiss();
      void authService.clearSession();
      setUser(null);
      setTokenState(null);
      const resetRouter = router as typeof router & { dismissAll?: () => void };
      resetRouter.dismissAll?.();
      router.replace("/");
    });
  }, []);

  const logout = async () => {
    await authService.logout();
    setUser(null);
    setTokenState(null);
  };

  const value = useMemo(() => ({
    user,
    isAuthenticated: Boolean(token),
    isReady,
    refreshAuth,
    logout,
  }), [isReady, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
