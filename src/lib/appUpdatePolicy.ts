/**
 * App update policy (pure: no React Native imports).
 *
 * The backend is the authority: `GET /app-versions/check?platform=&version=`
 * answers whether this installed version must or may update, with the
 * official store listing and an optional message. This module only validates
 * that answer and turns it into one decision; it does not compare versions
 * itself. Every failure fails open (the app runs normally): an unreachable or
 * malformed answer, an unsupported platform (web), an unusable installed
 * version, or an update without a valid official store listing never blocks
 * or prompts a user.
 */

export type AppPlatform = "android" | "ios" | "web";

/** The validated backend answer for this platform and installed version. */
export type AppVersionCheck = {
  updateRequired: boolean;
  updateAvailable: boolean;
  /** Dotted-number version, or null when absent / not a version. */
  latestVersion: string | null;
  minSupportedVersion: string | null;
  /** This app's official listing, or null when absent or not the official one. */
  storeUrl: string | null;
  /** The backend message as sent (plain text, never rendered as HTML). */
  message: string | null;
};

/** What an update prompt shows. Every field comes from the backend answer. */
export type UpdatePrompt = {
  storeUrl: string;
  latestVersion: string | null;
  /** The message as points (`messagePoints`); empty → no "What's new" panel. */
  releaseNotes: readonly string[];
};

export type UpdateDecision =
  | { kind: "none" }
  | ({ kind: "required" } & UpdatePrompt)
  | ({ kind: "available" } & UpdatePrompt);

export type SystemState = "maintenance" | "updateRequired" | "updateAvailable" | "app";

const VERSION_PATTERN = /^\d{1,6}(\.\d{1,6}){0,3}$/;

/** "1.10.0" → [1, 10, 0]; anything that is not dotted numbers → null. */
export function parseAppVersion(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!VERSION_PATTERN.test(text)) return null;
  return text.split(".").map(Number);
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function versionText(value: unknown): string | null {
  return parseAppVersion(value) ? String(value).trim() : null;
}

/**
 * The backend answer (`{ data: { update_required, update_available,
 * latest_version, min_supported_version, store_url, message } }`) for this
 * platform, or null when it is absent or malformed (fail open). Both flags
 * must be real booleans; the store URL must be this app's official listing.
 */
export function parseAppVersionCheck(raw: unknown, platform: AppPlatform): AppVersionCheck | null {
  if (platform === "web") return null;
  const data = record(record(raw)?.data);
  if (!data || typeof data.update_required !== "boolean" || typeof data.update_available !== "boolean") return null;
  return {
    updateRequired: data.update_required,
    updateAvailable: data.update_available,
    latestVersion: versionText(data.latest_version),
    minSupportedVersion: versionText(data.min_supported_version),
    storeUrl: validStoreUrl(data.store_url, platform),
    message: typeof data.message === "string" && data.message.trim() ? data.message : null,
  };
}

const MAX_MESSAGE_POINTS = 12;

/**
 * The backend message as bullet points: each sentence ending in "." is one
 * point. Contract assumption (documented in `docs/API_INTEGRATION.md`): a
 * period ends a point only when it is followed by whitespace or the end of
 * the text, so versions ("2.5.0"), domains ("lfa-ticketing.com") and
 * decimals stay intact. Points are trimmed, keep their punctuation, and empty
 * or punctuation-only segments (". ." / "...") are dropped. Plain text only.
 */
export function messagePoints(message: unknown): string[] {
  if (typeof message !== "string") return [];
  const segments: string[] = [];
  let start = 0;
  for (let index = 0; index < message.length; index += 1) {
    const next = message[index + 1];
    if (message[index] === "." && (next === undefined || /\s/.test(next))) {
      segments.push(message.slice(start, index + 1));
      start = index + 1;
    }
  }
  segments.push(message.slice(start));
  return segments
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter((segment) => /[^.\s]/.test(segment))
    .slice(0, MAX_MESSAGE_POINTS);
}

/**
 * The backend answer as one decision. Required wins if both flags are set.
 * No validated official store listing → no prompt (fail open: the user would
 * have no way to update, so they are never blocked by it). Web never gets a
 * native update state.
 */
export function decideUpdate({ platform, check }: { platform: AppPlatform; check: AppVersionCheck | null }): UpdateDecision {
  if (platform === "web" || !check || !check.storeUrl) return { kind: "none" };
  const prompt = { storeUrl: check.storeUrl, latestVersion: check.latestVersion, releaseNotes: messagePoints(check.message) };
  if (check.updateRequired) return { kind: "required", ...prompt };
  if (check.updateAvailable) return { kind: "available", ...prompt };
  return { kind: "none" };
}

/** What "Not now" dismisses for this launch: the offered latest version (or the unversioned offer). */
export function updateDismissKey(update: UpdateDecision): string | null {
  return update.kind === "available" ? update.latestVersion ?? "" : null;
}

/**
 * One state at a time, in a fixed priority (LFA Screen v3 layering):
 * backend maintenance (temporary, service-wide), then a required update, then
 * an optional update the user has not dismissed this launch, then the app.
 * When maintenance clears, an unsupported version is blocked at once. A
 * dismissal never hides a required update.
 */
export function systemState({
  update,
  maintenance,
  dismissedLatestVersion,
}: {
  update: UpdateDecision;
  maintenance: boolean;
  /** `updateDismissKey` of the optional prompt dismissed this launch, or null. */
  dismissedLatestVersion: string | null;
}): SystemState {
  if (maintenance) return "maintenance";
  if (update.kind === "required") return "updateRequired";
  if (update.kind === "available" && updateDismissKey(update) !== dismissedLatestVersion) return "updateAvailable";
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
