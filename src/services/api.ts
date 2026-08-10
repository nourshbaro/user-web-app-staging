import { config } from "@/lib/config";
import { createAuthenticationAuthority, type AuthenticationSnapshot } from "@/lib/authSessionOwnership";
import { storage } from "@/lib/storage";
import { Platform } from "react-native";

const TOKEN_KEY = "lfa_portal_token";
type UnauthenticatedListener = () => void;
type ApiRequestInit = RequestInit & { skipUnauthenticatedNotify?: boolean };
const unauthenticatedListeners = new Set<UnauthenticatedListener>();
const authenticationAuthority = createAuthenticationAuthority();
let authenticationMutation = Promise.resolve();

function enqueueAuthenticationMutation(operation: () => Promise<void>) {
  const pending = authenticationMutation.then(operation, operation);
  authenticationMutation = pending.catch(() => { });
  return pending;
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
  const ownership = authenticationAuthority.replace(token);
  await enqueueAuthenticationMutation(async () => {
    if (!authenticationAuthority.isCurrent(ownership)) return;
    await storage.set(TOKEN_KEY, token);
  });
}

export async function clearToken() {
  authenticationAuthority.replace(null);
  await enqueueAuthenticationMutation(() => storage.remove(TOKEN_KEY));
}

export async function clearAuthentication(cleanup?: () => Promise<void>) {
  authenticationAuthority.replace(null);
  await enqueueAuthenticationMutation(async () => {
    if (cleanup) await cleanup();
    await storage.remove(TOKEN_KEY);
  });
}

export async function captureAuthenticationSnapshot(): Promise<AuthenticationSnapshot> {
  while (true) {
    const generation = authenticationAuthority.currentGeneration();
    await authenticationMutation;
    if (generation !== authenticationAuthority.currentGeneration()) continue;
    const token = await storage.get(TOKEN_KEY);
    if (generation === authenticationAuthority.currentGeneration()) {
      return { generation, token };
    }
  }
}

export function isAuthenticationSnapshotCurrent(snapshot: AuthenticationSnapshot) {
  return authenticationAuthority.isCurrent(snapshot);
}

export async function beginAuthenticationLogout(cleanup?: () => Promise<void>) {
  const ownership = authenticationAuthority.replace(null);
  let logoutToken: string | null = null;

  await enqueueAuthenticationMutation(async () => {
    if (!authenticationAuthority.isCurrent(ownership)) return;
    logoutToken = await storage.get(TOKEN_KEY);
    if (cleanup) await cleanup();
    await storage.remove(TOKEN_KEY);
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
