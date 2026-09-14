import { router } from "expo-router";
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Keyboard } from "react-native";
import { authService } from "@/services/auth";
import {
  captureAuthenticationSnapshot,
  isAuthenticationSnapshotCurrent,
  onUnauthenticated,
} from "@/services/api";
import { clearUserScopedCaches } from "@/lib/userScopedCache";
import type { User } from "@/types";
import { registerPushDevice } from "@/lib/registerPushDevice";

type AuthContextValue = {
  user: User | null;
  userCacheKey: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  isRefreshingUser: boolean;
  refreshAuth: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (nextUser: User) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  changePassword: (
    currentPassword: string,
    password: string,
    passwordConfirmation: string,
  ) => Promise<string>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isReady, setReady] = useState(false);
  const [isRefreshingUser, setRefreshingUser] = useState(false);
  const userCacheKeyRef = useRef<string | null>(null);
  const userRefreshIdRef = useRef(0);

  const applySession = useCallback(
    (nextToken: string | null, nextUser: User | null) => {
      const nextUserCacheKey = nextToken ? userCacheKey(nextUser) : null;
      if (userCacheKeyRef.current !== nextUserCacheKey) {
        clearUserScopedCaches();
      }
      userCacheKeyRef.current = nextUserCacheKey;
      setTokenState(nextToken);
      setUser(nextUser);
    },
    [],
  );

  const clearSessionState = useCallback(() => {
    userRefreshIdRef.current += 1;
    clearUserScopedCaches();
    userCacheKeyRef.current = null;
    setUser(null);
    setTokenState(null);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const restoration = await authService.restoreSession();

      if (restoration.status === "stale") return;
      if (!isAuthenticationSnapshotCurrent(restoration.authentication)) return;

      if (restoration.status === "authenticated") {
        applySession(restoration.token, restoration.user);
        return;
      }

      clearSessionState();
    } finally {
      setReady(true);
    }
  }, [applySession, clearSessionState]);

  const refreshUser = useCallback(async () => {
    if (!token) return;

    const refreshId = ++userRefreshIdRef.current;
    const authentication = await captureAuthenticationSnapshot();
    setRefreshingUser(true);
    try {
      const nextUser = await authService.me();
      if (
        refreshId !== userRefreshIdRef.current ||
        !isAuthenticationSnapshotCurrent(authentication)
      )
        return;
      setUser(nextUser);
      await authService.persistUser(nextUser);
    } finally {
      if (refreshId === userRefreshIdRef.current) setRefreshingUser(false);
    }
  }, [token]);

  const updateUser = useCallback(async (nextUser: User) => {
    setUser(nextUser);
    await authService.persistUser(nextUser);
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (!isReady || !token) {
      return;
    }

    void registerPushDevice().catch((error) => {
      console.error("Authenticated device registration failed:", error);
    });
  }, [isReady, token]);

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

  const deleteAccount = useCallback(
    async (password: string) => {
      await authService.deleteAccount(password);
      clearSessionState();
    },
    [clearSessionState],
  );

  const changePassword = useCallback(async (
    currentPassword: string,
    password: string,
    passwordConfirmation: string,
  ) => {
    const successMessage = await authService.changePassword(
      currentPassword,
      password,
      passwordConfirmation,
    );
    Keyboard.dismiss();
    clearSessionState();
    try {
      await authService.clearSession();
    } catch (error) {
      console.error("Password-change session cleanup failed:", error);
    }
    const resetRouter = router as typeof router & { dismissAll?: () => void };
    resetRouter.dismissAll?.();
    router.replace("/");
    requestAnimationFrame(() => router.push("/auth"));
    return successMessage;
  }, [clearSessionState]);

  const value = useMemo(
    () => ({
      user,
      userCacheKey: token ? userCacheKey(user) : null,
      isAuthenticated: Boolean(token),
      isReady,
      isRefreshingUser,
      refreshAuth,
      refreshUser,
      updateUser,
      logout,
      deleteAccount,
      changePassword,
    }),
    [changePassword, deleteAccount, isReady, isRefreshingUser, logout, refreshAuth, refreshUser, token, updateUser, user],
  );

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
