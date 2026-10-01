import type { AuthenticationSnapshot } from "@/lib/authSessionOwnership";
import type { User } from "@/types";

/**
 * Ownership rule for an avatar upload / removal result. The session that
 * starts the request is captured from the authentication authority
 * (`captureAuthenticationSnapshot`) before the request; the result is
 * published into `AuthContext` only if that same authentication generation
 * is still current when the result arrives. Logout, login, session
 * restoration, password change and 401/403 invalidation all replace the
 * generation, so a result started by account A can never be published (or
 * persisted) into account B's session. The request itself is not cancelled.
 */
export type AvatarMutationOutcome = "published" | "unchanged" | "stale";

export async function runOwnedAvatarMutation<R>({
  capture,
  isCurrent,
  request,
  nextUser,
  publish,
}: {
  capture: () => Promise<AuthenticationSnapshot>;
  isCurrent: (snapshot: AuthenticationSnapshot) => boolean;
  request: () => Promise<R>;
  /** Builds the user to publish; read at publication time, after the ownership check. */
  nextUser: (result: R) => User | null;
  publish: (user: User) => Promise<void>;
}): Promise<AvatarMutationOutcome> {
  const authentication = await capture();
  const result = await request();
  if (!isCurrent(authentication)) return "stale";
  const user = nextUser(result);
  if (!user) return "unchanged";
  await publish(user);
  return "published";
}
