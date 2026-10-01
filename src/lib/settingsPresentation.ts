/**
 * Settings presentation rules. Pure module (no React Native imports).
 *
 * Push notifications have no app-side preference or API: the state shown is
 * the OS permission, read live, and the only action opens the phone's
 * settings. Nothing is stored locally as if it were a preference.
 */
export type PushPermission = "granted" | "denied" | "undetermined";

export type SettingsPushState = "checking" | "on" | "off" | "notAsked" | "unsupported";

/**
 * Push settings exist only where this app registers for push: an iOS or
 * Android build with a push runtime (`pushRuntimeSupported`, false in Expo
 * Go). Everywhere else (web) the card says so and offers no phone-settings action.
 */
export function pushSettingsSupported(platform: string, pushRuntimeSupported: boolean) {
  return (platform === "ios" || platform === "android") && pushRuntimeSupported;
}

export function settingsPushState(permission: PushPermission, loading: boolean, supported = true): { state: SettingsPushState; actionable: boolean } {
  if (!supported) return { state: "unsupported", actionable: false };
  if (loading) return { state: "checking", actionable: true };
  if (permission === "granted") return { state: "on", actionable: true };
  if (permission === "denied") return { state: "off", actionable: true };
  return { state: "notAsked", actionable: true };
}

/** Only languages with a complete catalog can be offered; today that is English alone. */
export function selectableLanguages(completeCatalogs: readonly string[]) {
  return completeCatalogs.length > 1 ? [...completeCatalogs] : [];
}
