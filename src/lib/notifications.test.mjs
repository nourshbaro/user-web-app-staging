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
  const messagingIndex = subscribe.indexOf("getConfiguredMessaging()");

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
  const messagingIndex = subscribe.indexOf("getConfiguredMessaging()");
  assert.ok(messagingIndex >= 0, "token refresh must resolve messaging through the guarded helper");
  assert.ok(guardIndex >= 0 && guardIndex < messagingIndex);
  const token = source.slice(source.indexOf("export async function getFcmDeviceToken("), source.indexOf("export function subscribeToFcmTokenRefresh("));
  assert.match(token, /if \(!Device\.isDevice \|\| !pushRuntimeSupported\) \{\s*return null;/);
});

test("a build without a default Firebase app degrades to no push instead of throwing at startup", () => {
  const helper = source.slice(
    source.indexOf("function getConfiguredMessaging("),
    source.indexOf("export async function getFcmDeviceToken("),
  );
  assert.ok(helper.length > 0, "guarded messaging helper is missing");
  // getMessaging() (which throws "No Firebase App '[DEFAULT]'") runs only inside the try.
  assert.match(helper, /try \{\s*return getMessaging\(getApp\(\)\);\s*\} catch \(error\) \{/);
  assert.match(helper, /console\.warn\(\s*"\[push\] Firebase is not configured/);
  assert.match(helper, /return null;\s*\}\s*\}\s*$/);

  // Every Firebase messaging call in this module goes through the helper.
  const outsideHelper = source.replace(helper, "");
  const outsideHelperCode = outsideHelper.split("\n").filter((line) => !/^\s*(\/\/|\/\*\*|\*)/.test(line)).join("\n");
  assert.doesNotMatch(outsideHelperCode, /\bgetMessaging\(/);
  assert.equal((outsideHelper.match(/getConfiguredMessaging\(\)/g) ?? []).length, 2);

  const subscribe = source.slice(source.indexOf("export function subscribeToFcmTokenRefresh("), source.indexOf("export async function getExpoPushToken("));
  assert.match(subscribe, /const messaging = getConfiguredMessaging\(\);\s*if \(!messaging\) return \(\) => \{\};\s*return onTokenRefresh\(messaging, onRefresh\);/);
  const token = source.slice(source.indexOf("export async function getFcmDeviceToken("), source.indexOf("export function subscribeToFcmTokenRefresh("));
  assert.match(token, /const messaging = getConfiguredMessaging\(\);\s*if \(!messaging\) return null;\s*return getFcmRegistrationToken\(messaging\);/);
});
