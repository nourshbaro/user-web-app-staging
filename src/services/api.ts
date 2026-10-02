import { config } from "@/lib/config";
import { createAuthenticationAuthority, type AuthenticationSnapshot } from "@/lib/authSessionOwnership";
import { Platform } from "react-native";
import { authTokenStorage } from "@/lib/authTokenStorage";
import { createMaintenanceAuthority, type AvailabilityProbeResult } from "@/lib/maintenanceAuthority";

type UnauthenticatedListener = () => void;
type ApiRequestInit = RequestInit & {
  skipUnauthenticatedNotify?: boolean;
  /**
   * Explicitly pins the Authorization header instead of deriving it from
   * the live session at fetch time: `null` forces an anonymous request
   * (no header, even if a session exists), a string sends that exact
   * bearer token. Omit to keep the default behavior of using whatever
   * session is current when the request fires.
   */
  overrideAuthorizationToken?: string | null;
};
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
const maintenance = createMaintenanceAuthority();
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
    await authTokenStorage.set(token);
  });
}

export async function clearToken() {
  replaceAuthentication(null);
  await enqueueAuthenticationMutation(() => authTokenStorage.remove());
}

export async function clearAuthentication(cleanup?: () => Promise<void>) {
  const ownership = replaceAuthentication(null);
  // A failed disk removal must never make an invalidated token usable again.
  suppressedAuthenticationGeneration = ownership.generation;

  await enqueueAuthenticationMutation(async () => {
    try {
      await authTokenStorage.remove();
    } finally {
      if (cleanup) await cleanup();
    }
  });
}

export async function captureAuthenticationSnapshot(): Promise<AuthenticationSnapshot> {
  while (true) {
    const generation = authenticationAuthority.currentGeneration();

    await authenticationMutation;

    if (generation !== authenticationAuthority.currentGeneration()) {
      continue;
    }

    const persistedToken = await authTokenStorage.get();

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
    token = await authTokenStorage.get();

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
      await authTokenStorage.remove();
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
    logoutToken = await authTokenStorage.get();
    await authTokenStorage.remove();
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
      await authTokenStorage.remove();
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

export function activateMaintenance() {
  maintenance.signal();
}

export function getMaintenanceSnapshot() {
  return maintenance.isActive();
}

export function subscribeMaintenance(listener: () => void) {
  return maintenance.subscribe(listener);
}

/**
 * The maintenance availability probe: a public, read-only, uncached request
 * (the scheduled-match filters), sent anonymously so it can never end or
 * change a session. A 2xx means the backend is serving again; a 503 is
 * maintenance (and is signalled by `apiRequest` as usual).
 */
const AVAILABILITY_PROBE_PATH = "/matches/scheduled/filters";

export async function probeBackendAvailability(): Promise<AvailabilityProbeResult> {
  try {
    await apiRequest(AVAILABILITY_PROBE_PATH, { overrideAuthorizationToken: null, skipUnauthenticatedNotify: true });
    return "available";
  } catch (error) {
    return error instanceof ApiError && error.status === 503 ? "maintenance" : "unreachable";
  }
}

/**
 * "Try again" on the maintenance screen. Clears maintenance only when the
 * probe succeeds and no 503 arrived meanwhile; single-flight. Never touches
 * the session, the cart or a payment.
 */
export function recheckMaintenance() {
  return maintenance.recheck(probeBackendAvailability);
}

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const authentication = await captureAuthenticationSnapshot();
  const hasAuthorizationOverride = "overrideAuthorizationToken" in init;
  const { skipUnauthenticatedNotify, overrideAuthorizationToken, ...requestInit } = init;
  const token = hasAuthorizationOverride ? overrideAuthorizationToken : authentication.token;
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, Number.isFinite(config.timeoutMs) ? config.timeoutMs : 15000);
  const url = Platform.OS === "web" ? `/api${path}` : `${config.apiBaseUrl}${path}`;

  const isFormData =
    typeof FormData !== "undefined" &&
    requestInit.body instanceof FormData;

  try {
    const response = await fetch(url, {
      ...requestInit,
      signal: controller.signal,
      headers: {
        Accept: "application/json",

        ...(!isFormData
          ? { "Content-Type": "application/json" }
          : {}),

        ...(Platform.OS !== "web" && config.apiPassword
          ? { password: config.apiPassword }
          : {}),

        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),

        ...(requestInit.headers ?? {}),
      },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      if (response.status === 503) activateMaintenance();
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
