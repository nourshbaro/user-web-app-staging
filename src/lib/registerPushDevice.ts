import { Platform } from "react-native";

import { getDevicePushToken } from "@/lib/notifications";
import { registerDevice } from "@/services/auth";

export async function registerPushDevice() {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return;
  }

  const token = await getDevicePushToken();

  if (!token) {
    return;
  }

  await registerDevice(token, Platform.OS);
}