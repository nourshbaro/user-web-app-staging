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
