import type { AppPlatform, PlatformUpdatePolicy } from "@/lib/appUpdatePolicy";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * The installed app version: the `version` embedded in this binary's Expo
 * config (`app.json`). The app has no over-the-air updates module, so this is
 * the version of the installed build.
 */
export function installedAppVersion(): string | null {
  const version = Constants.expoConfig?.version;
  return typeof version === "string" ? version : null;
}

export function currentAppPlatform(): AppPlatform {
  return Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "web";
}

/**
 * The update policy for this platform, from the backend.
 *
 * **No backend authority exists yet** (no endpoint returns a minimum / latest
 * version or the official store listings; `docs/API_INTEGRATION.md`). Until it
 * does, this resolves null and the update gate stays inactive (fail open): no
 * user is ever blocked or prompted on invented data. When the endpoint ships,
 * fetch it here through `apiRequest` and pass the payload to
 * `platformUpdatePolicy(payload, currentAppPlatform())`, which validates it.
 */
export async function loadAppUpdatePolicy(): Promise<PlatformUpdatePolicy | null> {
  return null;
}
