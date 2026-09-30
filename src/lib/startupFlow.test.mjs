import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LAUNCH_SPLASH_MIN_MS, LAUNCH_SPLASH_REDUCED_MIN_MS, launchSplashMinimumMs, shouldHideLaunchSplash } from "./launchSplash.ts";
import { decideOnboarding, nextOnboardingStep, serializeOnboardingCompleted } from "./onboarding.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const splashLib = strip(await read("./launchSplash.ts"));
const splashHook = strip(await read("../hooks/useLaunchSplash.ts"));
const splashView = strip(await read("../components/onboarding/LaunchSplash.tsx"));
const chrome = strip(await read("../components/AppChrome.tsx"));
const flow = strip(await read("../components/onboarding/OnboardingFlow.tsx"));
const gate = strip(await read("../hooks/useOnboardingGate.ts"));

test("the launch splash is an every-launch presentation, never a persisted first-run screen", () => {
  for (const [name, source] of [["lib", splashLib], ["hook", splashHook], ["view", splashView]]) {
    assert.doesNotMatch(source, /storage|AsyncStorage|SecureStore|localStorage|ONBOARDING_STORAGE_KEY|serializeOnboardingCompleted/, name);
    // It never navigates, so a direct entry resolves beneath it unchanged.
    assert.doesNotMatch(source, /router\.|useRouter|Redirect|Linking/, name);
  }
  // Mounted on every launch, independent of the onboarding decision.
  assert.match(chrome, /const splash = useLaunchSplash\(!onboarding\.deciding\);/);
  assert.match(chrome, /\{splash\.visible \? <LaunchSplash leaving=\{splash\.leaving\} onHidden=\{splash\.onHidden\} \/> : null\}/);
  assert.doesNotMatch(chrome, /onboarding\.visible \? <LaunchSplash|offerNotifications \? <LaunchSplash/);
  // In-memory per launch.
  assert.match(splashHook, /const \[gone, setGone\] = useState\(false\);/);
});

test("the launch splash stays until startup settles and its brief beat has played", () => {
  assert.equal(shouldHideLaunchSplash({ bootstrapSettled: false, minimumElapsed: true }), false);
  assert.equal(shouldHideLaunchSplash({ bootstrapSettled: true, minimumElapsed: false }), false);
  assert.equal(shouldHideLaunchSplash({ bootstrapSettled: true, minimumElapsed: true }), true);
  assert.equal(launchSplashMinimumMs(false), LAUNCH_SPLASH_MIN_MS);
  assert.equal(launchSplashMinimumMs(true), LAUNCH_SPLASH_REDUCED_MIN_MS);
  assert.ok(LAUNCH_SPLASH_REDUCED_MIN_MS < LAUNCH_SPLASH_MIN_MS);
  // Reduced motion: no fade, no entrance animation.
  assert.match(splashView, /if \(reducedMotion\) \{\s*onHidden\(\);\s*return;/);
  assert.match(splashView, /pointerEvents=\{leaving \? "none" : "auto"\}/);
});

test("first launch: welcome → notification choice → Home, for both choices, and only once", () => {
  // Welcome pages lead to the pre-prompt when push exists; the pre-prompt ends first run.
  assert.equal(nextOnboardingStep("intro", true), "notifications");
  assert.equal(nextOnboardingStep("notifications", true), "done");
  // Without a push runtime the welcome pages go straight to Home.
  assert.equal(nextOnboardingStep("intro", false), "done");
  // Both notification choices finish onboarding (flag written by the owner), revealing Home beneath.
  const turnOn = flow.slice(flow.indexOf("const turnOn = async"), flow.indexOf("return (", flow.indexOf("const turnOn = async")));
  assert.match(turnOn, /finally \{\s*setRequesting\(false\);\s*onFinish\(\);/);
  assert.match(flow, /onNotNow=\{onFinish\}/);
  assert.match(chrome, /onFinish=\{onboarding\.complete\}/);
  assert.match(gate, /const complete = useCallback\(\(\) => \{\s*setState\("hidden"\);\s*void storage\.set\(ONBOARDING_STORAGE_KEY, serializeOnboardingCompleted\(\)\)/);
  // Versioned flag: once completed, never again; signed-in users never see it.
  const fresh = { platform: "android", storedFlag: null, isAuthenticated: false, initialRouteIsHome: true };
  assert.deepEqual(decideOnboarding(fresh), { show: true });
  assert.deepEqual(decideOnboarding({ ...fresh, storedFlag: serializeOnboardingCompleted() }), { show: false, reason: "completed" });
  assert.deepEqual(decideOnboarding({ ...fresh, isAuthenticated: true }), { show: false, reason: "existing-user" });
  // The flow starts at the welcome pages (the splash is not a step).
  assert.match(flow, /useState<OnboardingStep>\("intro"\)/);
});

test("no authentication step at startup; sign-in stays in the normal app journey", () => {
  for (const source of [flow, chrome]) {
    assert.doesNotMatch(source, /AuthEntry|onAuthChoice|Continue as guest|auth\.entry|pathname: "\/auth"|router\.push/);
    assert.doesNotMatch(source, /useAuth|refreshAuth|setToken|authService/);
  }
});

test("Turn on is the only path to the permission prompt; Not now never asks", () => {
  const turnOn = flow.slice(flow.indexOf("const turnOn = async"), flow.indexOf("return (", flow.indexOf("const turnOn = async")));
  assert.match(turnOn, /await onTurnOnNotifications\(\);/);
  assert.equal((flow.match(/onTurnOnNotifications\(/g) ?? []).length, 1);
  // "Not now" is wired straight to finishing: no handler that could reach the prompt.
  assert.match(flow, /onNotNow=\{onFinish\}/);
  assert.match(chrome, /onTurnOnNotifications=\{optInToPushNotifications\}/);
});

test("critical direct entry is still decided before anything shows, and the splash cannot intercept it", () => {
  // The resolved-destination and launch-notification checks are unchanged.
  assert.match(gate, /navigation: navigationRef,/);
  assert.match(gate, /readLaunchNotificationTarget: async \(\) => notificationMatchId\(await getInitialNotificationData\(\)\)/);
  assert.match(gate, /if \(state === "visible" && shouldYieldToNavigation\(pathname\)\) \{/);
  // Onboarding is offered only when the gate decided to show it.
  assert.match(chrome, /\{onboarding\.visible \? \(\s*<OnboardingFlow/);
});
