import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  compareAppVersions,
  decideUpdate,
  parseAppVersion,
  parseReleaseNotes,
  platformUpdatePolicy,
  systemState,
  updatePromptCopy,
  validStoreUrl,
} from "./appUpdatePolicy.ts";
import {
  getSystemStatePreview,
  parseSystemStatePreview,
  setSystemStatePreview,
  systemStatePreviewFromUrl,
} from "./systemStatePreview.ts";

const PLAY = "https://play.google.com/store/apps/details?id=com.lfaticketing.app";
const APP_STORE = "https://apps.apple.com/lb/app/lfa-tickets/id1234567890";
const policy = (minimumVersion, latestVersion, storeUrl = PLAY, releaseNotes = []) => ({ minimumVersion, latestVersion, storeUrl, releaseNotes });
const decide = (installedVersion, p, platform = "android") => decideUpdate({ platform, installedVersion, policy: p }).kind;

/* Version comparison --------------------------------------------------------- */

test("versions compare numerically, never lexically", () => {
  assert.equal(compareAppVersions(parseAppVersion("1.10.0"), parseAppVersion("1.9.0")), 1);
  assert.equal(compareAppVersions(parseAppVersion("1.9.0"), parseAppVersion("1.10.0")), -1);
  assert.equal(compareAppVersions(parseAppVersion("2.0"), parseAppVersion("2.0.0")), 0);
  assert.equal(compareAppVersions(parseAppVersion("1.1.4"), parseAppVersion("1.1.10")), -1);
});

test("only dotted numeric versions parse", () => {
  assert.deepEqual(parseAppVersion(" 1.1.4 "), [1, 1, 4]);
  for (const bad of ["", "v1.2", "1..2", "1.2.x", "1.2.3-beta", null, undefined, 12, "1.2.3.4.5"]) {
    assert.equal(parseAppVersion(bad), null, String(bad));
  }
});

/* Update decision -------------------------------------------------------------- */

test("installed below minimum → required; at minimum → not required", () => {
  assert.equal(decide("1.1.3", policy("1.1.4", "1.2.0")), "required");
  assert.equal(decide("1.1.4", policy("1.1.4", "1.2.0")), "available");
});

test("between minimum and latest → available; at or above latest → none", () => {
  assert.equal(decide("1.1.9", policy("1.1.4", "1.10.0")), "available", "1.1.9 < 1.10.0 numerically");
  assert.equal(decide("1.10.0", policy("1.1.4", "1.10.0")), "none");
  assert.equal(decide("2.0.0", policy("1.1.4", "1.10.0")), "none");
});

test("without a latest version a required update still applies, an optional one never does", () => {
  assert.equal(decide("1.0.0", policy("1.1.4", null)), "required");
  assert.equal(decide("1.1.4", policy("1.1.4", null)), "none");
  const required = decideUpdate({ platform: "android", installedVersion: "1.0.0", policy: policy("1.1.4", null, PLAY, ["Faster checkout"]) });
  assert.deepEqual(required, { kind: "required", storeUrl: PLAY, latestVersion: null, releaseNotes: ["Faster checkout"] });
});

test("a malformed installed version, or no policy, never blocks anyone", () => {
  assert.equal(decide("not-a-version", policy("9.0.0", "9.0.0")), "none");
  assert.equal(decide(null, policy("9.0.0", "9.0.0")), "none");
  assert.equal(decide("1.0.0", null), "none");
});

test("web never receives a native update state", () => {
  assert.equal(decide("0.0.1", policy("9.0.0", "9.0.0"), "web"), "none");
  assert.equal(platformUpdatePolicy({ web: { minimum_version: "9", latest_version: "9", store_url: PLAY } }, "web"), null);
});

/* Backend policy -------------------------------------------------------------- */

const payload = {
  android: { minimum_version: "1.1.0", latest_version: "1.2.0", store_url: PLAY },
  ios: { minimum_version: "1.0.5", latest_version: "1.3.0", store_url: APP_STORE, release_notes: ["Ticket status on every ticket"] },
};

test("each platform reads only its own policy", () => {
  assert.deepEqual(platformUpdatePolicy(payload, "android"), { minimumVersion: "1.1.0", latestVersion: "1.2.0", storeUrl: PLAY, releaseNotes: [] });
  assert.deepEqual(platformUpdatePolicy(payload, "ios"), { minimumVersion: "1.0.5", latestVersion: "1.3.0", storeUrl: APP_STORE, releaseNotes: ["Ticket status on every ticket"] });
});

test("latest version is optional, but a present one must be valid and not below minimum", () => {
  assert.deepEqual(
    platformUpdatePolicy({ android: { minimum_version: "1.1.0", store_url: PLAY } }, "android"),
    { minimumVersion: "1.1.0", latestVersion: null, storeUrl: PLAY, releaseNotes: [] },
  );
  assert.equal(platformUpdatePolicy({ android: { ...payload.android, latest_version: "soon" } }, "android"), null);
});

test("a missing or malformed policy is ignored (fail open), never a block", () => {
  for (const raw of [null, undefined, "x", {}, { android: null }, { android: { minimum_version: "1.0" } }]) {
    assert.equal(platformUpdatePolicy(raw, "android"), null, JSON.stringify(raw));
  }
  // Bad versions, a store URL that is not this app's listing, or latest below minimum.
  assert.equal(platformUpdatePolicy({ android: { ...payload.android, minimum_version: "latest" } }, "android"), null);
  assert.equal(platformUpdatePolicy({ android: { ...payload.android, store_url: "https://evil.example/app" } }, "android"), null);
  assert.equal(platformUpdatePolicy({ android: { ...payload.android, minimum_version: "2.0.0", latest_version: "1.0.0" } }, "android"), null);
  // The iOS listing is never accepted for Android and vice versa.
  assert.equal(platformUpdatePolicy({ android: { ...payload.android, store_url: APP_STORE } }, "android"), null);
  assert.equal(platformUpdatePolicy({ ios: { ...payload.ios, store_url: PLAY } }, "ios"), null);
});

/* Release notes ------------------------------------------------------------------- */

test("release notes come only from the policy: trimmed strings, bounded, malformed entries dropped", () => {
  assert.deepEqual(parseReleaseNotes(undefined), []);
  assert.deepEqual(parseReleaseNotes("Faster"), []);
  assert.deepEqual(parseReleaseNotes([" Faster seat selection ", "", 7, null, "x".repeat(161), "Bug fixes"]), ["Faster seat selection", "Bug fixes"]);
  assert.equal(parseReleaseNotes(Array.from({ length: 10 }, (_, i) => `Note ${i}`)).length, 6);
  // Malformed notes never invalidate the version policy.
  assert.deepEqual(platformUpdatePolicy({ android: { ...payload.android, release_notes: { a: 1 } } }, "android")?.releaseNotes, []);
});

/* Prompt copy --------------------------------------------------------------------- */

test("the version-specific v3 wording only with a real latest version; otherwise version-free copy", () => {
  assert.deepEqual(updatePromptCopy("available", { latestVersion: null, releaseNotes: [] }), {
    titleKey: "update.available.title",
    body: { key: "update.available.body" },
    releaseNotes: [],
  });
  assert.deepEqual(updatePromptCopy("required", { latestVersion: null, releaseNotes: [] }).body, { key: "update.required.body" });
  assert.deepEqual(updatePromptCopy("required", { latestVersion: "1.3.0", releaseNotes: [] }).body, { key: "update.required.bodyVersion", version: "1.3.0" });
  assert.deepEqual(updatePromptCopy("available", { latestVersion: "1.3.0", releaseNotes: ["A"] }), {
    titleKey: "update.available.title",
    body: { key: "update.available.bodyVersion", version: "1.3.0" },
    releaseNotes: ["A"],
  });
  assert.deepEqual(updatePromptCopy("available", { latestVersion: "garbage", releaseNotes: [] }).body, { key: "update.available.body" });
});

/* Store links ------------------------------------------------------------------- */

test("only this app's official store listing is accepted", () => {
  assert.equal(validStoreUrl(PLAY, "android"), PLAY);
  assert.equal(validStoreUrl(` ${PLAY} `, "android"), PLAY);
  assert.equal(validStoreUrl(APP_STORE, "ios"), APP_STORE);
  assert.equal(validStoreUrl("https://apps.apple.com/app/id1234567890", "ios"), "https://apps.apple.com/app/id1234567890");
  for (const [url, platform] of [
    ["http://play.google.com/store/apps/details?id=com.lfaticketing.app", "android"],
    ["https://play.google.com/store/apps/details?id=com.other.app", "android"],
    ["https://play.google.com.evil.example/store/apps/details?id=com.lfaticketing.app", "android"],
    ["https://user:pw@play.google.com/store/apps/details?id=com.lfaticketing.app", "android"],
    ["market://details?id=com.lfaticketing.app", "android"],
    ["https://apps.apple.com/lb/app/lfa-tickets/notanid", "ios"],
    ["https://example.com/app/id1234567890", "ios"],
    ["javascript:alert(1)", "ios"],
    [PLAY, "web"],
  ]) {
    assert.equal(validStoreUrl(url, platform), null, `${platform} ${url}`);
  }
});

test("store links that a lenient (React Native) URL parser could misread are rejected", () => {
  for (const [url, platform] of [
    [`${PLAY}@evil.example`, "android"],
    [`${PLAY}&id=com.other.app`, "android"],
    [`${PLAY}#@evil.example`, "android"],
    ["https://play.google.com:8443/store/apps/details?id=com.lfaticketing.app", "android"],
    ["https://play.google.com\\@evil.example/store/apps/details?id=com.lfaticketing.app", "android"],
    ["HTTPS://PLAY.GOOGLE.COM/store/apps/details?id=com.lfaticketing.app", "android"],
    ["https://play.google.com/store/apps/details?id=com.lfaticketing.app.evil", "android"],
    [`${APP_STORE}?redirect=https://evil.example`, "ios"],
    ["https://apps.apple.com.evil.example/app/id1234567890", "ios"],
    ["https://evil.example/https://apps.apple.com/app/id1234567890", "ios"],
  ]) {
    assert.equal(validStoreUrl(url, platform), null, `${platform} ${url}`);
  }
});

/* Startup priority --------------------------------------------------------------- */

const required = { kind: "required", storeUrl: PLAY, latestVersion: "1.2.0", releaseNotes: [] };
const available = { kind: "available", storeUrl: PLAY, latestVersion: "1.2.0", releaseNotes: [] };
const none = { kind: "none" };

test("one state at a time: maintenance > required update > optional update > app", () => {
  assert.equal(systemState({ update: required, maintenance: true, dismissedLatestVersion: null }), "maintenance");
  assert.equal(systemState({ update: available, maintenance: true, dismissedLatestVersion: null }), "maintenance");
  assert.equal(systemState({ update: none, maintenance: true, dismissedLatestVersion: null }), "maintenance");
  assert.equal(systemState({ update: required, maintenance: false, dismissedLatestVersion: null }), "updateRequired");
  assert.equal(systemState({ update: available, maintenance: false, dismissedLatestVersion: null }), "updateAvailable");
  assert.equal(systemState({ update: none, maintenance: false, dismissedLatestVersion: null }), "app");
});

test("when maintenance clears, an unsupported version is blocked at once", () => {
  const during = systemState({ update: required, maintenance: true, dismissedLatestVersion: null });
  const after = systemState({ update: required, maintenance: false, dismissedLatestVersion: null });
  assert.deepEqual([during, after], ["maintenance", "updateRequired"]);
});

test("an optional update can be dismissed; a required one cannot, and a dismissal never bypasses it", () => {
  assert.equal(systemState({ update: available, maintenance: false, dismissedLatestVersion: "1.2.0" }), "app");
  assert.equal(systemState({ update: required, maintenance: false, dismissedLatestVersion: "1.2.0" }), "updateRequired");
  // A newer latest version is offered again.
  assert.equal(systemState({ update: { ...available, latestVersion: "1.3.0" }, maintenance: false, dismissedLatestVersion: "1.2.0" }), "updateAvailable");
});

/* Development preview --------------------------------------------------------- */

beforeEach(() => setSystemStatePreview(null, true));

test("the preview only switches when enabled (development), and only to the three states", () => {
  setSystemStatePreview("updateRequired", false);
  assert.equal(getSystemStatePreview(), null, "a production build can never be switched");
  setSystemStatePreview("maintenance", true);
  assert.equal(getSystemStatePreview(), "maintenance");
  assert.equal(parseSystemStatePreview("updateAvailable"), "updateAvailable");
  for (const bad of ["app", "normal", "", null, "UpdateRequired"]) assert.equal(parseSystemStatePreview(bad), null, String(bad));
});

test("dev preview links: a state, normal (clear), or nothing", () => {
  assert.equal(systemStatePreviewFromUrl("lfa-app:///?systemStatePreview=maintenance"), "maintenance");
  assert.equal(systemStatePreviewFromUrl("lfa-app://matches?x=1&systemStatePreview=updateRequired"), "updateRequired");
  assert.equal(systemStatePreviewFromUrl("exp+lfa-app://expo-development-client/?systemStatePreview=updateAvailable#x"), "updateAvailable");
  assert.equal(systemStatePreviewFromUrl("lfa-app:///?systemStatePreview=normal"), null);
  for (const url of [null, "", "lfa-app:///", "lfa-app:///?systemStatePreview=app", "lfa-app:///?systemStatePreview=maintenanceX", "lfa-app:///?xsystemStatePreview=maintenance"]) {
    assert.equal(systemStatePreviewFromUrl(url), undefined, String(url));
  }
});
