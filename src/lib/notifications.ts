import Constants from "expo-constants";
import * as Device from "expo-device";
import { isRunningInExpoGo } from "expo";
import type * as NotificationsModule from "expo-notifications";
import { Platform } from "react-native";
import {
  getMessaging,
  getToken as getFcmRegistrationToken,
  onTokenRefresh,
} from "@react-native-firebase/messaging";

/**
 * Push is available in development and release builds. It is not in Expo Go:
 * since SDK 53, `expo-notifications` throws *while being imported* on Android
 * Expo Go (its auto-registration side effect calls `addPushTokenListener`,
 * which throws there), and Expo Go ships no React Native Firebase native
 * module, so `getMessaging()` throws on every platform. In Expo Go this module
 * therefore never loads `expo-notifications` and never touches Firebase; every
 * helper degrades to "no push". Builds behave exactly as before.
 */
export const pushRuntimeSupported = !isRunningInExpoGo();

// Loaded eagerly (same timing as the former static import) wherever push is
// supported; a conditional require keeps Expo Go from evaluating the package.
const Notifications: typeof NotificationsModule | null = pushRuntimeSupported
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? (require("expo-notifications") as typeof NotificationsModule)
  : null;

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export type NotificationPermissionState =
  | "granted"
  | "denied"
  | "undetermined";

export type NotificationData = Record<string, unknown>;

function notificationData(response: NotificationsModule.NotificationResponse | null): NotificationData | null {
  const data = response?.notification.request.content.data;
  return data && typeof data === "object" ? (data as NotificationData) : null;
}

/**
 * Data of the notification that launched the app, if any. A push
 * notification never launches the web app, and `expo-notifications` does not
 * implement the launch response there (it throws), so web has none.
 */
export async function getInitialNotificationData(): Promise<NotificationData | null> {
  if (!Notifications || Platform.OS === "web") return null;
  return notificationData(await Notifications.getLastNotificationResponseAsync());
}

/** Subscribes to notification taps; returns the unsubscribe function. */
export function subscribeToNotificationResponses(onData: (data: NotificationData) => void): () => void {
  if (!Notifications) return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = notificationData(response);
    if (data) onData(data);
  });
  return () => subscription.remove();
}

/**
 * Subscribes to notifications received while the app is running (foreground);
 * returns the unsubscribe function. Used only to re-read the inbox and unread
 * count from the backend; the payload is not trusted for any state.
 */
export function subscribeToReceivedNotifications(onReceive: () => void): () => void {
  if (!Notifications) return () => {};
  const subscription = Notifications.addNotificationReceivedListener(() => onReceive());
  return () => subscription.remove();
}

export async function configureNotificationChannel() {
  if (Platform.OS !== "android" || !Notifications) {
    return;
  }

  await Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  // No push runtime: report "denied" so nothing prompts or registers.
  if (!Notifications) return "denied";

  const settings = await Notifications.getPermissionsAsync();

  if (settings.status === Notifications.PermissionStatus.GRANTED) {
    return "granted";
  }

  if (settings.status === Notifications.PermissionStatus.DENIED) {
    return "denied";
  }

  return "undetermined";
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!Notifications) return "denied";

  const requested =
    await Notifications.requestPermissionsAsync();

  if (
    requested.status ===
    Notifications.PermissionStatus.GRANTED
  ) {
    return "granted" as const;
  }

  if (
    requested.status ===
    Notifications.PermissionStatus.DENIED
  ) {
    return "denied" as const;
  }

  return "undetermined" as const;
}

export async function getDevicePushToken(): Promise<string | null> {
  if (!Device.isDevice || !Notifications) {
    return null;
  }

  const permission = await getNotificationPermissionStatus();

  if (permission !== "granted") {
    return null;
  }

  const token = await Notifications.getDevicePushTokenAsync();

  return typeof token.data === "string"
    ? token.data
    : JSON.stringify(token.data);
}

export async function getFcmDeviceToken(): Promise<string | null> {
  if (!Device.isDevice || !pushRuntimeSupported) {
    return null;
  }

  const permission = await getNotificationPermissionStatus();

  if (permission !== "granted") {
    return null;
  }

  return getFcmRegistrationToken(getMessaging());
}

export function subscribeToFcmTokenRefresh(
  onRefresh: (token: string) => void,
): () => void {
  // FCM is native-only; on web no default Firebase app exists and
  // getMessaging() throws, matching registerPushDevice's platform guard.
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return () => {};
  }
  // Expo Go has no React Native Firebase native module.
  if (!pushRuntimeSupported) {
    return () => {};
  }

  return onTokenRefresh(getMessaging(), onRefresh);
}

export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice || !Notifications) {
    return null;
  }

  const permission = await getNotificationPermissionStatus();

  if (permission !== "granted") {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    throw new Error("Expo project ID is not configured.");
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return token.data;
}
