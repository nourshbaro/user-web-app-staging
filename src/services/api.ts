import { config } from "@/lib/config";
import { createAuthenticationAuthority, type AuthenticationSnapshot } from "@/lib/authSessionOwnership";
import { storage } from "@/lib/storage";
import { Platform } from "react-native";

const TOKEN_KEY = "lfa_portal_token";
type UnauthenticatedListener = () => void;
type ApiRequestInit = RequestInit & { skipUnauthenticatedNotify?: boolean };
export type PersistedAuthenticationValue<T> =
  | { status: "missing" }
  | { status: "valid"; value: T }
  | { status: "invalid" };

export type AuthenticationRestoration<T> =
  | {
    status: "authenticated";
    authentication: AuthenticationSnapshot;
    token: string;
    user: T;
  }
  | {
    status: "unauthenticated" | "invalid" | "storage-error";
    authentication: AuthenticationSnapshot;
  }
  | { status: "stale" };
const unauthenticatedListeners = new Set<UnauthenticatedListener>();
const authenticationAuthority = createAuthenticationAuthority();
let suppressedAuthenticationGeneration: number | null = null;
let authenticationMutation = Promise.resolve();

function enqueueAuthenticationMutation(operation: () => Promise<void>) {
  const pending = authenticationMutation.then(operation, operation);
  authenticationMutation = pending.catch(() => { });
  return pending;
}

function replaceAuthentication(token: string | null) {
  const ownership = authenticationAuthority.replace(token);
  suppressedAuthenticationGeneration = null;
  return ownership;
}

function suppressAuthentication(snapshot: AuthenticationSnapshot) {
  const ownership = authenticationAuthority.claim(snapshot);
  if (!ownership) return null;

  suppressedAuthenticationGeneration = ownership.generation;
  return { ...ownership, token: null };
}

function usableTokenForGeneration(generation: number, token: string | null) {
  return suppressedAuthenticationGeneration === generation ? null : token;
}

export class ApiError extends Error {
  status: number;
  body: any;

  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class ApiTransportError extends Error {
  category: "network" | "timeout";
  originalError: unknown;

  constructor(message: string, category: "network" | "timeout", originalError: unknown) {
    super(message);
    this.category = category;
    this.originalError = originalError;
  }
}

export async function getToken() {
  return (await captureAuthenticationSnapshot()).token;
}

export async function setToken(token: string) {
  const ownership = replaceAuthentication(token);

  await enqueueAuthenticationMutation(async () => {
    if (!authenticationAuthority.isCurrent(ownership)) return;
    await storage.set(TOKEN_KEY, token);
  });
}

export async function clearToken() {
  replaceAuthentication(null);
  await enqueueAuthenticationMutation(() => storage.remove(TOKEN_KEY));
}

export async function clearAuthentication(cleanup?: () => Promise<void>) {
  replaceAuthentication(null);

  await enqueueAuthenticationMutation(async () => {
    await storage.remove(TOKEN_KEY);
    if (cleanup) await cleanup();
  });
}

export async function captureAuthenticationSnapshot(): Promise<AuthenticationSnapshot> {
  while (true) {
    const generation = authenticationAuthority.currentGeneration();

    await authenticationMutation;

    if (generation !== authenticationAuthority.currentGeneration()) {
      continue;
    }

    const persistedToken = await storage.get(TOKEN_KEY);

    if (generation === authenticationAuthority.currentGeneration()) {
      return {
        generation,
        token: usableTokenForGeneration(generation, persistedToken),
      };
    }
  }
}

export async function restoreAuthentication<T>(
  readUser: () => Promise<PersistedAuthenticationValue<T>>,
  clearUser: () => Promise<void>,
): Promise<AuthenticationRestoration<T>> {
  const generation = authenticationAuthority.currentGeneration();

  await authenticationMutation;

  if (generation !== authenticationAuthority.currentGeneration()) {
    return { status: "stale" };
  }

  let token: string | null = null;
  let persistedUser: PersistedAuthenticationValue<T>;

  try {
    token = await storage.get(TOKEN_KEY);

    if (generation !== authenticationAuthority.currentGeneration()) {
      return { status: "stale" };
    }

    persistedUser = await readUser();
  } catch {
    const failureOwnership = suppressAuthentication({
      generation,
      token,
    });

    if (!failureOwnership) {
      return { status: "stale" };
    }

    return {
      status: "storage-error",
      authentication: failureOwnership,
    };
  }

  if (generation !== authenticationAuthority.currentGeneration()) {
    return { status: "stale" };
  }

  if (suppressedAuthenticationGeneration === generation) {
    return {
      status: "unauthenticated",
      authentication: { generation, token: null },
    };
  }

  const authentication = { generation, token };

  if (token && persistedUser.status === "valid") {
    return {
      status: "authenticated",
      authentication,
      token,
      user: persistedUser.value,
    };
  }

  if (!token && persistedUser.status === "missing") {
    return {
      status: "unauthenticated",
      authentication,
    };
  }

  const cleanupOwnership = suppressAuthentication(authentication);
  if (!cleanupOwnership) {
    return { status: "stale" };
  }

  let cleanupFailed = false;

  await enqueueAuthenticationMutation(async () => {
    if (!authenticationAuthority.isCurrent(cleanupOwnership)) return;

    try {
      await storage.remove(TOKEN_KEY);
    } catch {
      cleanupFailed = true;
    }

    if (!authenticationAuthority.isCurrent(cleanupOwnership)) return;

    try {
      await clearUser();
    } catch {
      cleanupFailed = true;
    }
  });

  if (!authenticationAuthority.isCurrent(cleanupOwnership)) {
    return { status: "stale" };
  }

  return {
    status: cleanupFailed ? "storage-error" : "invalid",
    authentication: cleanupOwnership,
  };
}

export function isAuthenticationSnapshotCurrent(snapshot: AuthenticationSnapshot) {
  return authenticationAuthority.isCurrent(snapshot);
}

export async function beginAuthenticationLogout(cleanup?: () => Promise<void>) {
  const ownership = replaceAuthentication(null);
  let logoutToken: string | null = null;

  await enqueueAuthenticationMutation(async () => {
    if (!authenticationAuthority.isCurrent(ownership)) return;
    logoutToken = await storage.get(TOKEN_KEY);
    await storage.remove(TOKEN_KEY);
    if (cleanup) await cleanup();
  });

  return { ...ownership, token: logoutToken };
}

export async function invalidateAuthentication(
  snapshot: AuthenticationSnapshot,
  options: { notify?: boolean; cleanup?: () => Promise<void> } = {},
) {
  const claim = authenticationAuthority.claim(snapshot);
  if (!claim) return false;

  try {
    await enqueueAuthenticationMutation(async () => {
      if (!authenticationAuthority.isCurrent(claim)) return;
      if (options.cleanup) await options.cleanup();
      await storage.remove(TOKEN_KEY);
    });
  } catch {
    return false;
  }

  if (!authenticationAuthority.isCurrent(claim)) return false;
  if (options.notify !== false) notifyUnauthenticated();
  return true;
}

export function onUnauthenticated(listener: UnauthenticatedListener) {
  unauthenticatedListeners.add(listener);
  return () => {
    unauthenticatedListeners.delete(listener);
  };
}

export function notifyUnauthenticated() {
  unauthenticatedListeners.forEach((listener) => listener());
}

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const authentication = await captureAuthenticationSnapshot();
  const token = authentication.token;
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, Number.isFinite(config.timeoutMs) ? config.timeoutMs : 15000);
  const url = Platform.OS === "web" ? `/api${path}` : `${config.apiBaseUrl}${path}`;
  const { skipUnauthenticatedNotify, ...requestInit } = init;

  try {
    const response = await fetch(url, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(Platform.OS !== "web" && config.apiPassword ? { password: config.apiPassword } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(requestInit.headers ?? {}),
      },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      if (!skipUnauthenticatedNotify && (response.status === 401 || response.status === 403)) {
        await invalidateAuthentication(authentication);
      }
      const message = body?.message ?? body?.error ?? `Request failed with ${response.status}`;
      throw new ApiError(message, response.status, body);
    }

    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (didTimeout) throw new ApiTransportError("The request timed out. Please try again.", "timeout", error);
    throw new ApiTransportError("Unable to reach the server. Check your connection and try again.", "network", error);
  } finally {
    clearTimeout(timeout);
  }
}

export function unwrapData<T>(payload: T | { data: T }): T {
  return payload && typeof payload === "object" && "data" in payload ? (payload as { data: T }).data : payload as T;
}
