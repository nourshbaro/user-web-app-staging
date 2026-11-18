export type AuthenticationSnapshot = {
  generation: number;
  token: string | null;
};

export function createAuthenticationAuthority() {
  let generation = 0;

  return {
    currentGeneration() {
      return generation;
    },
    capture(token: string | null): AuthenticationSnapshot {
      return { generation, token };
    },
    replace(token: string | null): AuthenticationSnapshot {
      generation += 1;
      return { generation, token };
    },
    claim(snapshot: AuthenticationSnapshot): AuthenticationSnapshot | null {
      if (snapshot.generation !== generation) return null;
      generation += 1;
      return { generation, token: snapshot.token };
    },
    isCurrent(snapshot: AuthenticationSnapshot) {
      return snapshot.generation === generation;
    },
  };
}

/**
 * Which token a request sends, and which authentication a 401/403 response
 * may end. A 401/403 only ever invalidates the snapshot whose token was
 * actually sent:
 * - `pinned`: the caller's own snapshot (for example the card screen's,
 *   captured when the form opened). Its token is sent and it alone is
 *   invalidated; if it is no longer current the request must not be sent
 *   (`stale`), so it can never act for a newer account.
 * - an explicit `override` token without a snapshot cannot be attributed to
 *   a generation: a 401/403 then invalidates nothing.
 * - otherwise the live snapshot captured for the request.
 */
export function requestAuthentication({
  live,
  pinned,
  hasOverride,
  override,
  isCurrent,
}: {
  live: AuthenticationSnapshot;
  pinned?: AuthenticationSnapshot;
  hasOverride: boolean;
  override?: string | null;
  isCurrent: (snapshot: AuthenticationSnapshot) => boolean;
}): { token: string | null; invalidates: AuthenticationSnapshot | null; stale: boolean } {
  if (pinned) return { token: pinned.token, invalidates: pinned, stale: !isCurrent(pinned) };
  if (hasOverride) return { token: override ?? null, invalidates: null, stale: false };
  return { token: live.token, invalidates: live, stale: false };
}
