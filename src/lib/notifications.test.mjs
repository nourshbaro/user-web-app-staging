import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./notifications.ts", import.meta.url), "utf8");

test("FCM token-refresh subscription is native-only so web startup never touches Firebase", () => {
  const subscribe = source.slice(
    source.indexOf("export function subscribeToFcmTokenRefresh("),
    source.indexOf("export async function getExpoPushToken("),
  );
  const guardIndex = subscribe.indexOf('if (Platform.OS !== "android" && Platform.OS !== "ios")');
  const messagingIndex = subscribe.indexOf("onTokenRefresh(getMessaging(), onRefresh)");

  assert.ok(guardIndex >= 0, "platform guard is missing");
  assert.ok(messagingIndex > guardIndex, "getMessaging() must only run after the platform guard");
  assert.match(subscribe, /return \(\) => \{\};/);
});

test("the launch notification is never read on web (unsupported there; it threw on every web start)", () => {
  const initial = source.slice(
    source.indexOf("export async function getInitialNotificationData("),
    source.indexOf("export function subscribeToNotificationResponses("),
  );
  const guardIndex = initial.indexOf('if (!Notifications || Platform.OS === "web") return null;');
  const readIndex = initial.indexOf("getLastNotificationResponseAsync()");
  assert.ok(guardIndex >= 0, "web guard is missing");
  assert.ok(readIndex > guardIndex, "the launch response is read only after the web guard");
});

test("expo-notifications is never evaluated in Expo Go, and nothing else imports it at runtime", async () => {
  // Android Expo Go (SDK 53+) throws while importing expo-notifications, which
  // made every route importing AuthContext/_layout fail to evaluate.
  assert.match(source, /^import type \* as NotificationsModule from "expo-notifications";$/m);
  assert.doesNotMatch(source, /^import (?!type)[^\n]*from "expo-notifications";$/m, "no static runtime import");
  assert.match(source, /export const pushRuntimeSupported = !isRunningInExpoGo\(\);/);
  assert.match(source, /= pushRuntimeSupported\s*\/\/[^\n]*\n\s*\? \(require\("expo-notifications"\)/);
  // Builds keep the foreground handler and every push path.
  assert.match(source, /Notifications\?\.setNotificationHandler\(\{/);
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter((file) => /\.tsx?$/.test(file) && !file.endsWith("notifications.ts"));
  for (const file of files) {
    const text = await readFile(new URL(file.replaceAll("\\", "/"), root), "utf8");
    assert.doesNotMatch(text, /^import (?!type)[^\n]*from "expo-notifications";$/m, file);
  }
});

test("Firebase messaging is only reached where the push runtime exists", () => {
  const subscribe = source.slice(source.indexOf("export function subscribeToFcmTokenRefresh("), source.indexOf("export async function getExpoPushToken("));
  const guardIndex = subscribe.indexOf("if (!pushRuntimeSupported)");
  assert.ok(guardIndex >= 0 && guardIndex < subscribe.indexOf("onTokenRefresh(getMessaging(), onRefresh)"));
  const token = source.slice(source.indexOf("export async function getFcmDeviceToken("), source.indexOf("export function subscribeToFcmTokenRefresh("));
  assert.match(token, /if \(!Device\.isDevice \|\| !pushRuntimeSupported\) \{\s*return null;/);
});
