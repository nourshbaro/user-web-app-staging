/**
 * Registration name: the form collects First name and Last name separately,
 * but the backend contract (`POST /auth/register`) takes one `name`. This is
 * the only place that combines them, at submit time from the live field
 * values — nothing caches a combined name.
 *
 * Only surrounding whitespace is trimmed and an empty part rejected; no
 * script or character rules, so Arabic and other non-Latin names pass as typed.
 */

export type RegistrationNameResult =
  | { ok: true; name: string }
  | { ok: false; missing: "firstName" | "lastName" };

export function registrationName(firstName: string, lastName: string): RegistrationNameResult {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!first) return { ok: false, missing: "firstName" };
  if (!last) return { ok: false, missing: "lastName" };
  return { ok: true, name: `${first} ${last}` };
}
