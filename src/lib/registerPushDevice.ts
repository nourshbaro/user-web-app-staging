import { Platform } from "react-native";

import {
  getFcmDeviceToken,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/lib/notifications";
import { registerAnonymousDevice, registerAuthenticatedDevice } from "@/services/auth";
import { captureAuthenticationSnapshot } from "@/services/api";
import { shouldRequestPermissionOnTurnOn } from "@/lib/onboarding";

// Sends whichever token is current under whatever session is current *right
// now* — anonymous when logged out, authenticated when logged in. Re-sending
// the same token authenticated right after an earlier anonymous send (e.g.
// on login) is intentional: it's how the backend associates a device that
// registered before the user signed in.
//
// The snapshot below only decides which shape of request to send; it is
// never pinned into the request itself. registerAuthenticatedDevice lets
// apiRequest resolve the live session immediately before it builds headers,
// so a logout/account-switch that lands after this decision can't result in
// a stale bearer token going out — it naturally resolves to no token (sent
// as anonymous) or to whichever account is current by then.
async function sendDeviceToken(fcmToken: string) {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return;
  }

  const authentication = await captureAuthenticationSnapshot();

  if (!authentication.token) {
    await registerAnonymousDevice(fcmToken, Platform.OS);
    return;
  }

  await registerAuthenticatedDevice(fcmToken, Platform.OS);
}

export async function registerPushDevice() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return;
  }

  const fcmToken = await getFcmDeviceToken();
  if (!fcmToken) return;

  await sendDeviceToken(fcmToken);
}

/**
 * Startup: registers only when the user has ALREADY granted permission (a
 * previous launch, Settings, or the OS default). It never asks: the native
 * prompt is shown only from an explicit user action (`optInToPushNotifications`).
 */
export async function registerPushDeviceIfPermitted() {
  if ((await getNotificationPermissionStatus()) !== "granted") return;
  await registerPushDevice();
}

/**
 * The explicit "Turn on notifications" action: shows the native prompt, then
 * registers exactly as a previously granted launch would.
 */
export async function optInToPushNotifications(): Promise<NotificationPermissionState> {
  // Already granted: never ask the OS again; just keep the registration.
  const current = await getNotificationPermissionStatus();
  const permission = shouldRequestPermissionOnTurnOn(current) ? await requestNotificationPermission() : current;
  if (permission === "granted") await registerPushDevice();
  return permission;
}

export async function registerRefreshedPushDevice(fcmToken: string) {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return;
  }

  if (!fcmToken) return;

  await sendDeviceToken(fcmToken);
}
