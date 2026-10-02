/**
 * App update policy (pure: no React Native imports).
 *
 * The backend has no version-policy contract yet (`docs/API_INTEGRATION.md`
 * §15). This module holds the rules the app applies once one exists; until
 * then the provider (`src/services/appUpdate.ts`) returns no policy, and every
 * rule here fails open (the app runs normally). A missing or malformed policy,
 * or an unreadable installed version, never blocks a user.
 */

export type AppPlatform = "android" | "ios" | "web";

export type PlatformUpdatePolicy = {
  minimumVersion: string;
  /** Null when the policy names no latest version (no optional prompt is possible). */
  latestVersion: string | null;
  storeUrl: string;
  /** Release notes from the policy; empty when none (the "What's new" panel is omitted). */
  releaseNotes: readonly string[];
};

/** What an update prompt shows. Every field comes from the backend policy. */
export type UpdatePrompt = {
  storeUrl: string;
  latestVersion: string | null;
  releaseNotes: readonly string[];
};

export type UpdateDecision =
  | { kind: "none" }
  | ({ kind: "required" } & UpdatePrompt)
  | ({ kind: "available" } & UpdatePrompt & { latestVersion: string });

export type SystemState = "maintenance" | "updateRequired" | "updateAvailable" | "app";

const VERSION_PATTERN = /^\d{1,6}(\.\d{1,6}){0,3}$/;

/** "1.10.0" → [1, 10, 0]; anything that is not dotted numbers → null. */
export function parseAppVersion(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!VERSION_PATTERN.test(text)) return null;
  return text.split(".").map(Number);
}

/** Numeric, segment by segment; missing segments count as 0 (1.2 == 1.2.0). Never lexical. */
export function compareAppVersions(a: readonly number[], b: readonly number[]) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Only the official listing for this app: Google Play for the Android package
 * (`com.lfaticketing.app`), the App Store for an app id. https only, no
 * credentials, ports, other hosts, extra query or fragment.
 *
 * Whole-string patterns, deliberately not `new URL()`: React Native's `URL`
 * is a lenient regex shim that never throws, so a parser-based check would
 * behave differently on a device than under Node.
 */
const STORE_URL_PATTERNS: Record<Exclude<AppPlatform, "web">, RegExp> = {
  android: /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.lfaticketing\.app$/,
  ios: /^https:\/\/apps\.apple\.com\/(?:[a-z]{2}\/)?app\/(?:[a-z0-9-]+\/)?id\d{5,12}\/?$/,
};

export function validStoreUrl(value: unknown, platform: AppPlatform): string | null {
  if (typeof value !== "string" || platform === "web") return null;
  const url = value.trim();
  return STORE_URL_PATTERNS[platform].test(url) ? url : null;
}

const MAX_RELEASE_NOTES = 6;
const MAX_RELEASE_NOTE_LENGTH = 160;

/**
 * Release notes from the policy: non-empty strings, trimmed, at most six of at
 * most 160 characters each. Anything else is dropped; malformed notes never
 * invalidate the version policy itself.
 */
export function parseReleaseNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((note): note is string => typeof note === "string")
    .map((note) => note.trim())
    .filter((note) => note.length > 0 && note.length <= MAX_RELEASE_NOTE_LENGTH)
    .slice(0, MAX_RELEASE_NOTES);
}

/**
 * The policy for one platform from a backend response, or null when it is
 * absent or malformed (fail open). Proposed shape (not an existing API):
 * `{ android: { minimum_version, latest_version?, store_url, release_notes? }, ios: { … } }`.
 */
export function platformUpdatePolicy(raw: unknown, platform: AppPlatform): PlatformUpdatePolicy | null {
  if (platform === "web" || !raw || typeof raw !== "object") return null;
  const entry = (raw as Record<string, unknown>)[platform];
  if (!entry || typeof entry !== "object") return null;
  const {
    minimum_version: minimum,
    latest_version: latest,
    store_url: store,
    release_notes: notes,
  } = entry as Record<string, unknown>;
  const minimumParts = parseAppVersion(minimum);
  const storeUrl = validStoreUrl(store, platform);
  if (!minimumParts || !storeUrl) return null;
  let latestVersion: string | null = null;
  if (latest !== undefined && latest !== null) {
    const latestParts = parseAppVersion(latest);
    // A malformed or inconsistent latest version (below minimum) is not trusted.
    if (!latestParts || compareAppVersions(latestParts, minimumParts) < 0) return null;
    latestVersion = String(latest).trim();
  }
  return {
    minimumVersion: String(minimum).trim(),
    latestVersion,
    storeUrl,
    releaseNotes: parseReleaseNotes(notes),
  };
}

/**
 * installed < minimum → required (blocking); minimum ≤ installed < latest →
 * available (optional); otherwise none. Web never gets a native update state.
 */
export function decideUpdate({
  platform,
  installedVersion,
  policy,
}: {
  platform: AppPlatform;
  installedVersion: unknown;
  policy: PlatformUpdatePolicy | null;
}): UpdateDecision {
  if (platform === "web" || !policy) return { kind: "none" };
  const installed = parseAppVersion(installedVersion);
  const minimum = parseAppVersion(policy.minimumVersion);
  if (!installed || !minimum) return { kind: "none" };
  const prompt = { storeUrl: policy.storeUrl, releaseNotes: policy.releaseNotes };
  if (compareAppVersions(installed, minimum) < 0) {
    return { kind: "required", ...prompt, latestVersion: policy.latestVersion };
  }
  const latest = policy.latestVersion ? parseAppVersion(policy.latestVersion) : null;
  if (policy.latestVersion && latest && compareAppVersions(installed, latest) < 0) {
    return { kind: "available", ...prompt, latestVersion: policy.latestVersion };
  }
  return { kind: "none" };
}

/**
 * One state at a time, in a fixed priority (LFA Screen v3 layering):
 * backend maintenance (temporary, service-wide), then a required update, then
 * an optional update the user has not dismissed for that latest version, then
 * the app. When maintenance clears, an unsupported version is blocked at once.
 * A dismissal never hides a required update.
 */
export function systemState({
  update,
  maintenance,
  dismissedLatestVersion,
}: {
  update: UpdateDecision;
  maintenance: boolean;
  /** The latest version whose optional prompt was dismissed (this launch). */
  dismissedLatestVersion: string | null;
}): SystemState {
  if (maintenance) return "maintenance";
  if (update.kind === "required") return "updateRequired";
  if (update.kind === "available" && update.latestVersion !== dismissedLatestVersion) return "updateAvailable";
  return "app";
}

export type UpdatePromptCopy = {
  titleKey: "update.required.title" | "update.available.title";
  body:
    | { key: "update.required.body" | "update.available.body" }
    | { key: "update.required.bodyVersion" | "update.available.bodyVersion"; version: string };
  /** The "What's new" panel renders only when this is non-empty. */
  releaseNotes: readonly string[];
};

/**
 * The prompt's copy: v3's version-specific wording only with a real latest
 * version from the policy, otherwise the version-free wording. Never a
 * placeholder version or invented release notes.
 */
export function updatePromptCopy(
  kind: "required" | "available",
  prompt: Pick<UpdatePrompt, "latestVersion" | "releaseNotes">,
): UpdatePromptCopy {
  const version = prompt.latestVersion && parseAppVersion(prompt.latestVersion) ? prompt.latestVersion.trim() : null;
  return {
    titleKey: kind === "required" ? "update.required.title" : "update.available.title",
    body: version
      ? { key: kind === "required" ? "update.required.bodyVersion" : "update.available.bodyVersion", version }
      : { key: kind === "required" ? "update.required.body" : "update.available.body" },
    releaseNotes: prompt.releaseNotes,
  };
}
