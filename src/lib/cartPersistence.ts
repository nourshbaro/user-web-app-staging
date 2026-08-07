export const CART_SESSION_PERSISTENCE_VERSION = 1;

export type PersistedCartSession =
  | { kind: "none" }
  | { kind: "legacy"; sessionId: string }
  | { kind: "active"; sessionId: string; expiresAt: string; expiresAtMs: number }
  | { kind: "expired"; sessionId: string; expiresAt: string; expiresAtMs: number }
  | { kind: "malformed" };

type CartSessionRecord = {
  version: typeof CART_SESSION_PERSISTENCE_VERSION;
  sessionId: string;
  expiresAt: string;
};

function isValidExpiry(expiresAt: string) {
  return Number.isFinite(Date.parse(expiresAt));
}

export function isCartExpiryReached(expiresAt: Date | null, now: number) {
  return expiresAt !== null && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now;
}

export function serializePersistedCartSession(sessionId: string, expiresAt: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || !isValidExpiry(expiresAt)) return null;

  const record: CartSessionRecord = {
    version: CART_SESSION_PERSISTENCE_VERSION,
    sessionId: normalizedSessionId,
    expiresAt,
  };
  return JSON.stringify(record);
}

export function parsePersistedCartSession(raw: string | null, now: number): PersistedCartSession {
  if (raw === null) return { kind: "none" };

  const value = raw.trim();
  if (!value) return { kind: "malformed" };

  if (!value.startsWith("{") && !value.startsWith("[")) {
    return { kind: "legacy", sessionId: value };
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return { kind: "malformed" };
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { kind: "malformed" };
  }

  const record = candidate as Partial<CartSessionRecord>;
  if (
    record.version !== CART_SESSION_PERSISTENCE_VERSION
    || typeof record.sessionId !== "string"
    || !record.sessionId.trim()
    || typeof record.expiresAt !== "string"
    || !isValidExpiry(record.expiresAt)
  ) {
    return { kind: "malformed" };
  }

  const sessionId = record.sessionId.trim();
  const expiresAtMs = Date.parse(record.expiresAt);
  if (expiresAtMs <= now) {
    return { kind: "expired", sessionId, expiresAt: record.expiresAt, expiresAtMs };
  }

  return { kind: "active", sessionId, expiresAt: record.expiresAt, expiresAtMs };
}
