import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  getMessaging,
  getToken as getFcmRegistrationToken,
  onTokenRefresh,
} from "@react-native-firebase/messaging";

Notifications.setNotificationHandler({
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

export async function configureNotificationChannel() {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionState> {
  const settings = await Notifications.getPermissionsAsync();

  if (settings.status === Notifications.PermissionStatus.GRANTED) {
    return "granted";
  }

  if (settings.status === Notifications.PermissionStatus.DENIED) {
    return "denied";
  }

  return "undetermined";
}

export async function requestNotificationPermission() {
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
  if (!Device.isDevice) {
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
  if (!Device.isDevice) {
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

  return onTokenRefresh(getMessaging(), onRefresh);
}

export async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
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
