import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const layoutSource = await read("../app/_layout.tsx");
const gateSource = await read("../components/maintenance/SystemStateGate.tsx");
const screenSource = await read("../components/maintenance/MaintenanceScreen.tsx");
const dialogSource = await read("../components/maintenance/UpdatePromptDialog.tsx");
const tileSource = await read("../components/maintenance/SystemLogoTile.tsx");
const apiSource = await read("../services/api.ts");

test("the root system-state gate wraps the navigation tree globally", () => {
  assert.match(layoutSource, /<SystemStateGate>[\s\S]*<Stack/);
  assert.match(layoutSource, /<\/Stack>[\s\S]*<\/SystemStateGate>/);
  assert.match(gateSource, /useSyncExternalStore\(subscribeMaintenance, getMaintenanceSnapshot, getMaintenanceSnapshot\)/);
  // Maintenance replaces the navigator; providers (session, cart) stay above it.
  assert.match(gateSource, /if \(state === "maintenance"\) \{[\s\S]*return <MaintenanceScreen onRetry=\{retry\} \/>;/);
  // One state at a time, from the pure priority rule.
  assert.match(gateSource, /systemState\(\{ update, maintenance, dismissedLatestVersion \}\)/);
});

test("Try again rechecks through the maintenance authority; nothing clears the flag directly", () => {
  assert.match(gateSource, /previewing \? retryPreviewMaintenance : recheckMaintenance/);
  assert.match(apiSource, /export function recheckMaintenance\(\) \{\s*return maintenance\.recheck\(probeBackendAvailability\);/);
  assert.match(apiSource, /overrideAuthorizationToken: null, skipUnauthenticatedNotify: true/);
  for (const source of [gateSource, screenSource]) {
    assert.doesNotMatch(source, /clearSession|clearToken|clearAuthentication|clearCart|expireCart|setInterval|AppState/);
    assert.doesNotMatch(source, /maintenance\s*=\s*false|setMaintenance/);
  }
  // Pending: the button is busy (and disabled) while one check runs.
  assert.match(screenSource, /if \(checking\) return;/);
  assert.match(screenSource, /loading=\{checking\}/);
});

test("the maintenance screen follows LFA Screen v3 with production copy and contact", () => {
  assert.match(screenSource, /t\("maintenance\.badge"\)/);
  assert.match(screenSource, /t\("maintenance\.title"\)/);
  assert.match(screenSource, /t\("maintenance\.body"\)/);
  assert.match(screenSource, /variant="displayHero"/);
  assert.match(screenSource, /<SystemLogoTile size=\{84\} radius=\{24\} crest=\{54\}/);
  // WhatsApp comes from the official contact authority, never a literal number.
  assert.match(screenSource, /OFFICIAL_CONTACTS\.find\(/);
  assert.doesNotMatch(screenSource, /wa\.me|9617|https?:\/\//);
  // User-facing copy comes from the message catalog (AGENTS.md §11).
  assert.match(screenSource, /t\("maintenance\.contactFailed\.title"\)/);
  assert.match(screenSource, /t\("maintenance\.contactFailed\.message"\)/);
  for (const source of [screenSource, dialogSource]) {
    assert.doesNotMatch(source, /(title|message|accessibilityLabel|accessibilityHint): "[A-Z]/);
  }
  assert.match(screenSource, /useSafeAreaInsets/);
  assert.match(screenSource, /useReducedMotion/);
  assert.match(tileSource, /lfa-logo\.png/);
});

test("the update dialog: a required update cannot be dismissed, an optional one only by Not now / Back", () => {
  assert.match(dialogSource, /const dismissible = kind === "available" && Boolean\(onDismiss\);/);
  assert.match(dialogSource, /onRequestClose=\{\(\) => \{\s*if \(dismissible\) onDismiss\?\.\(\);/);
  assert.match(dialogSource, /\{dismissible \? \(\s*<Pressable\s*onPress=\{onDismiss\}/);
  // The scrim is not a press target.
  assert.doesNotMatch(dialogSource, /<Pressable[^>]*StyleSheet\.absoluteFill/);
  // The store link is re-validated when opened; opening it never dismisses.
  assert.match(dialogSource, /const url = validStoreUrl\(storeUrl, currentAppPlatform\(\)\);/);
  assert.doesNotMatch(dialogSource.slice(dialogSource.indexOf("const openStore"), dialogSource.indexOf("const storeLabel")), /onDismiss/);
  // No placeholder version, no invented release notes.
  assert.doesNotMatch(dialogSource, /2\.5\.0|Faster seat selection/);
  assert.match(dialogSource, /copy\.releaseNotes\.length > 0 \?/);
  assert.match(dialogSource, /useReducedMotion/);
});

test("the development preview is gated by __DEV__ and carries no invented store data", () => {
  assert.match(gateSource, /const previewing = __DEV__ && preview !== null;/);
  assert.match(gateSource, /if \(!__DEV__\) return;/);
  assert.match(gateSource, /setSystemStatePreview\(next, __DEV__\)/);
  assert.match(gateSource, /storeUrl: null, latestVersion: null, releaseNotes: \[\]/);
});
