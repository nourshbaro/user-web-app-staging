import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  decideOnboarding,
  isHomeRouteName,
  isOnboardingCompleted,
  ONBOARDING_STORAGE_KEY,
  serializeOnboardingCompleted,
  shouldOfferNotificationStep,
  shouldYieldToNavigation,
} from "./onboarding.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const fresh = { platform: "ios", storedFlag: null, isAuthenticated: false, initialRouteIsHome: true };

test("the flag is versioned and only an explicit completion counts", () => {
  assert.equal(ONBOARDING_STORAGE_KEY, "lfa_onboarding_v1");
  assert.equal(isOnboardingCompleted(serializeOnboardingCompleted()), true);
  for (const value of [null, "", "true", "1", "{}"]) assert.equal(isOnboardingCompleted(value), false, String(value));
});

test("onboarding is offered only on a first native launch whose resolved destination is Home", () => {
  assert.deepEqual(decideOnboarding(fresh), { show: true });
  assert.deepEqual(decideOnboarding({ ...fresh, platform: "android" }), { show: true });
  assert.deepEqual(decideOnboarding({ ...fresh, platform: "web" }), { show: false, reason: "web" });
  assert.deepEqual(decideOnboarding({ ...fresh, storedFlag: serializeOnboardingCompleted() }), { show: false, reason: "completed" });
  // Existing (signed-in) users are never sent through it.
  assert.deepEqual(decideOnboarding({ ...fresh, isAuthenticated: true }), { show: false, reason: "existing-user" });
  assert.deepEqual(decideOnboarding({ ...fresh, initialRouteIsHome: false }), { show: false, reason: "direct-entry" });
});

test("only the Home route name counts as Home; once visible, any navigation away wins", () => {
  assert.equal(isHomeRouteName("index"), true);
  for (const name of ["match/[id]", "auth", "checkout", "checkout/success", "checkout/failed", "checkout/blue/success", "checkout/blue/failed", "checkout/card/payment", "cart", "tickets", "competitions", "tournament", null, undefined, ""]) {
    assert.equal(isHomeRouteName(name), false, String(name));
  }
  assert.equal(shouldYieldToNavigation("/"), false);
  assert.equal(shouldYieldToNavigation("/match/7"), true);
});

test("the notification pre-prompt appears only while the OS can still ask", () => {
  assert.equal(shouldOfferNotificationStep("undetermined", true), true);
  assert.equal(shouldOfferNotificationStep("granted", true), false);
  assert.equal(shouldOfferNotificationStep("denied", true), false);
  // No push runtime (Expo Go, web): never offered.
  assert.equal(shouldOfferNotificationStep("undetermined", false), false);
});

test("startup never requests notification permission; granted users keep registering", async () => {
  const layout = strip(await read("../app/_layout.tsx"));
  assert.doesNotMatch(layout, /requestNotificationPermission|requestPermissionsAsync|optInToPushNotifications/);
  assert.match(layout, /await registerPushDeviceIfPermitted\(\);/);
  // Token refresh and notification-tap routing are unchanged.
  assert.match(layout, /subscribeToFcmTokenRefresh\(\(nextToken\) => \{/);
  assert.match(layout, /registerRefreshedPushDevice\(nextToken\)/);
  assert.match(layout, /getInitialNotificationData\(\)/);
  assert.match(layout, /return subscribeToNotificationResponses\(handleNotificationNavigation\);/);

  const register = await read("./registerPushDevice.ts");
  const ifPermitted = register.slice(register.indexOf("export async function registerPushDeviceIfPermitted"), register.indexOf("export async function optInToPushNotifications"));
  assert.match(ifPermitted, /if \(\(await getNotificationPermissionStatus\(\)\) !== "granted"\) return;/);
  assert.doesNotMatch(ifPermitted, /requestNotificationPermission/);
  const optIn = register.slice(register.indexOf("export async function optInToPushNotifications"), register.indexOf("export async function registerRefreshedPushDevice"));
  assert.match(optIn, /const permission = await requestNotificationPermission\(\);\s*if \(permission === "granted"\) await registerPushDevice\(\);/);
});

test("the native prompt is reachable from onboarding only through the explicit Turn on action", async () => {
  const flow = strip(await read("../components/onboarding/OnboardingFlow.tsx"));
  const chrome = strip(await read("../components/AppChrome.tsx"));
  assert.doesNotMatch(flow, /requestNotificationPermission|requestPermissionsAsync|registerPushDevice|@\/lib\/notifications/);
  assert.match(chrome, /onTurnOnNotifications=\{optInToPushNotifications\}/);
  // Only the turnOn handler calls it; "Not now" just finishes.
  const turnOn = flow.slice(flow.indexOf("const turnOn = async"), flow.indexOf("return (", flow.indexOf("const turnOn = async")));
  assert.match(turnOn, /await onTurnOnNotifications\(\);/);
  assert.match(flow, /title=\{t\("onboarding\.notifications\.turnOn"\)\}\s*onPress=\{onTurnOn\}/);
  assert.match(flow, /title=\{t\("onboarding\.notifications\.notNow"\)\}[^>]*onPress=\{onNotNow\}/);
  assert.match(flow, /onNotNow=\{onFinish\}/);
  assert.equal(flow.match(/onTurnOnNotifications\(/g)?.length, 1);
});

test("onboarding owns no navigation or data, and has no favourite-team step", async () => {
  const flow = strip(await read("../components/onboarding/OnboardingFlow.tsx"));
  const gate = strip(await read("../hooks/useOnboardingGate.ts"));
  for (const source of [flow, gate]) {
    assert.doesNotMatch(source, /router\.|useRouter|Redirect|apiRequest|Service\.|useCart|favou?rite|team selection/i);
  }
  assert.match(gate, /storage\.set\(ONBOARDING_STORAGE_KEY, serializeOnboardingCompleted\(\)\)/);
  // Steps aside (not completed) when navigation leaves Home.
  assert.match(gate, /if \(state === "visible" && shouldYieldToNavigation\(pathname\)\) \{\s*setState\("hidden"\);/);
  // Motion honours reduced motion; the splash never auto-advances under a screen reader.
  assert.match(flow, /useReducedMotion\(\)/);
  assert.match(flow, /if \(cancelled \|\| screenReader\) return;/);
});

test("the native splash stays up until onboarding is decided, then the overlay hides the app from assistive tech", async () => {
  const layout = strip(await read("../app/_layout.tsx"));
  const chrome = strip(await read("../components/AppChrome.tsx"));
  // Held while the launch is unresolved, but never deadlocked by maintenance replacing the navigator.
  assert.match(layout, /if \(isReady && fontsSettled && \(!onboarding\.deciding \|\| maintenance\)\) \{\s*SplashScreen\.hide\(\);/);
  assert.match(layout, /const maintenance = useSyncExternalStore\(subscribeMaintenance, getMaintenanceSnapshot, getMaintenanceSnapshot\);/);
  assert.match(chrome, /importantForAccessibility=\{onboarding\.visible \? "no-hide-descendants" : "auto"\}/);
  assert.match(chrome, /accessibilityElementsHidden=\{onboarding\.visible\}/);
});
