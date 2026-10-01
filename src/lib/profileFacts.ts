/**
 * Profile display facts, only from the backend `User` (`/auth/me`). Pure module. Nothing
 * is invented: no membership tier, no verification without
 * `email_verified_at`, no "member since" without a parseable `created_at`.
 */
export type ProfileUser = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  email_verified_at?: string | null;
  created_at?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function profileInitials(name: string | null) {
  if (!name) return "LF";
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
}

export function profileFacts(user: ProfileUser | null | undefined) {
  const name = text(user?.name);
  const email = text(user?.email);
  const created = text(user?.created_at);
  const createdDate = created ? new Date(created) : null;
  return {
    name: name ?? email ?? "LFA supporter",
    initials: profileInitials(name),
    email,
    phone: text(user?.phone),
    emailVerified: text(user?.email_verified_at) !== null,
    /** Account creation date (format for display); null when absent or unparseable. */
    memberSince: createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate : null,
  };
}
