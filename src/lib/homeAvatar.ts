/**
 * What the Home header avatar shows. Presentation only: it reads the
 * signed-in user that `AuthContext` already owns (Profile publishes avatar
 * changes there through `updateUser`) and resolves the image with the same
 * resolver Profile uses (`storageUrl`, passed in). It never fetches.
 *
 * - signed in, avatar present and not failed to load → the profile image;
 * - signed in without a usable image → v3 initials from the real name;
 * - signed out (or no name) → the generic person mark.
 */
export type HomeAvatar =
  | { kind: "image"; uri: string; initials: string | null }
  | { kind: "initials"; initials: string }
  | { kind: "person" };

export function homeAvatar({
  isAuthenticated,
  user,
  failedUri,
  resolveImage,
  initialsOf,
}: {
  isAuthenticated: boolean;
  user: { name?: string | null; avatar?: string | null } | null;
  /** The image URI that failed to load, if any; a different URI is tried again. */
  failedUri: string | null;
  resolveImage: (path: string) => string | undefined;
  initialsOf: (name: string) => string;
}): HomeAvatar {
  if (!isAuthenticated || !user) return { kind: "person" };
  const name = user.name?.trim();
  const initials = name ? initialsOf(name).slice(0, 2) || null : null;
  const uri = user.avatar ? resolveImage(user.avatar) : undefined;
  if (uri && uri !== failedUri) return { kind: "image", uri, initials };
  return initials ? { kind: "initials", initials } : { kind: "person" };
}
