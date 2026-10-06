import { parseAppVersion, parseAppVersionCheck, type AppPlatform, type AppVersionCheck } from "@/lib/appUpdatePolicy";
import { apiRequest } from "@/services/api";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * The installed app version: the `version` embedded in this binary's Expo
 * config (`app.json`). The app has no over-the-air updates module, so in a
 * store / EAS build this is the version of the installed build. (A
 * development client reads it from the dev server's manifest instead.)
 */
export function installedAppVersion(): string | null {
  const version = Constants.expoConfig?.version;
  return typeof version === "string" ? version : null;
}

export function currentAppPlatform(): AppPlatform {
  return Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "web";
}

/**
 * The version-check path for the running app, or null when there is nothing
 * to ask: web has no store build, and an unusable version is never sent.
 */
export function appVersionCheckPath(platform: AppPlatform, version: string | null): string | null {
  if (platform === "web" || !version || !parseAppVersion(version)) return null;
  const params = new URLSearchParams({ platform, version: version.trim() });
  return `/app-versions/check?${params.toString()}`;
}

async function requestAppVersionCheck(): Promise<AppVersionCheck | null> {
  const platform = currentAppPlatform();
  const path = appVersionCheckPath(platform, installedAppVersion());
  if (!path) return null;
  try {
    return parseAppVersionCheck(await apiRequest<unknown>(path, { overrideAuthorizationToken: null, skipUnauthenticatedNotify: true }), platform);
  } catch {
    return null;
  }
}

let launchCheck: Promise<AppVersionCheck | null> | null = null;

/**
 * The backend's update answer for this platform and installed version
 * (`GET /app-versions/check`), validated, or null (fail open) when there is
 * nothing to ask, the request fails or the answer is malformed. Asked once per
 * launch: the gate that reads it (`useAppUpdateDecision`) remounts when the
 * signed-in identity changes, and every mount shares this one answer. It is
 * public: no session token is sent, and a 401 never touches the session.
 */
export function loadAppVersionCheck(): Promise<AppVersionCheck | null> {
  launchCheck ??= requestAppVersionCheck();
  return launchCheck;
}
