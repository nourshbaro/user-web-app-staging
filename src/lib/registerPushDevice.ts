import { Platform } from "react-native";

import { getDevicePushToken } from "@/lib/notifications";
import { registerDevice } from "@/services/auth";
import { captureAuthenticationSnapshot, isAuthenticationSnapshotCurrent } from "@/services/api";

export async function registerPushDevice() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return;
  }

  const authentication = await captureAuthenticationSnapshot();
  if (!authentication.token) return;
  const token = await getDevicePushToken();

  if (!token || !isAuthenticationSnapshotCurrent(authentication)) {
    return;
  }

  await registerDevice(token, Platform.OS);
}
