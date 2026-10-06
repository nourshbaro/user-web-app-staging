import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  decideUpdate,
  messagePoints,
  parseAppVersion,
  parseAppVersionCheck,
  systemState,
  updateDismissKey,
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
/** A backend `/app-versions/check` body. */
const answer = (data) => ({ data: { update_required: false, update_available: false, latest_version: null, min_supported_version: null, store_url: null, message: null, ...data } });
const decide = (raw, platform = "android") => decideUpdate({ platform, check: parseAppVersionCheck(raw, platform) });

/* Versions --------------------------------------------------------------------- */

test("only dotted numeric versions parse", () => {
  assert.deepEqual(parseAppVersion(" 1.1.4 "), [1, 1, 4]);
  for (const bad of ["", "v1.2", "1..2", "1.2.x", "1.2.3-beta", null, undefined, 12, "1.2.3.4.5"]) {
    assert.equal(parseAppVersion(bad), null, String(bad));
  }
});

/* Backend answer → decision (the backend is the authority) ---------------------- */

test("the staging 'nothing to do' answer is no update", () => {
  assert.deepEqual(decide(answer({})), { kind: "none" });
  assert.deepEqual(parseAppVersionCheck(answer({}), "android"), {
    updateRequired: false, updateAvailable: false, latestVersion: null, minSupportedVersion: null, storeUrl: null, message: null,
  });
});

test("update_required → a blocking required update with the backend's store listing, version and message", () => {
  const decision = decide(answer({ update_required: true, latest_version: "2.0.0", min_supported_version: "1.5.0", store_url: PLAY, message: "Security fixes. New checkout." }));
  assert.deepEqual(decision, { kind: "required", storeUrl: PLAY, latestVersion: "2.0.0", releaseNotes: ["Security fixes.", "New checkout."] });
});

test("update_available → an optional update", () => {
  assert.equal(decide(answer({ update_available: true, latest_version: "1.2.0", store_url: PLAY })).kind, "available");
});

test("required wins if the backend ever sets both flags", () => {
  assert.equal(decide(answer({ update_required: true, update_available: true, store_url: PLAY })).kind, "required");
});

test("no version comparison of its own: the backend flags decide, whatever the versions say", () => {
  // The backend says nothing is needed even though min_supported is above any installed version: trusted.
  assert.equal(decide(answer({ min_supported_version: "99.0.0", latest_version: "99.0.0", store_url: PLAY })).kind, "none");
});

test("fail open: a malformed answer never blocks or prompts", () => {
  const malformed = [
    null, undefined, "ok", [], {}, { data: null }, { data: [] },
    answer({ update_required: "true", store_url: PLAY }),
    answer({ update_available: 1, store_url: PLAY }),
    { data: { store_url: PLAY } },
  ];
  for (const raw of malformed) {
    assert.equal(parseAppVersionCheck(raw, "android"), null, JSON.stringify(raw));
    assert.deepEqual(decide(raw), { kind: "none" }, JSON.stringify(raw));
  }
});

test("fail open: a required or available update without the official store listing is not shown", () => {
  for (const store of [null, "", "https://evil.example/app", APP_STORE, `${PLAY}&hl=en`, "http://play.google.com/store/apps/details?id=com.lfaticketing.app"]) {
    assert.deepEqual(decide(answer({ update_required: true, store_url: store })), { kind: "none" }, String(store));
    assert.deepEqual(decide(answer({ update_available: true, store_url: store })), { kind: "none" }, String(store));
  }
  assert.equal(decide(answer({ update_required: true, store_url: APP_STORE }), "ios").kind, "required");
});

test("web never receives a native update state", () => {
  assert.equal(parseAppVersionCheck(answer({ update_required: true, store_url: PLAY }), "web"), null);
  const check = { updateRequired: true, updateAvailable: false, latestVersion: null, minSupportedVersion: null, storeUrl: PLAY, message: null };
  assert.deepEqual(decideUpdate({ platform: "web", check }), { kind: "none" });
});

test("unusable version fields are dropped, not trusted; the update itself still applies", () => {
  const check = parseAppVersionCheck(answer({ update_required: true, latest_version: "soon", min_supported_version: "v2", store_url: PLAY }), "android");
  assert.equal(check.latestVersion, null);
  assert.equal(check.minSupportedVersion, null);
  assert.deepEqual(decideUpdate({ platform: "android", check }), { kind: "required", storeUrl: PLAY, latestVersion: null, releaseNotes: [] });
});

test("a non-string or blank message is no message (no 'What's new' panel)", () => {
  for (const message of [null, 42, { a: 1 }, ["x"], "   "]) {
    assert.deepEqual(decide(answer({ update_required: true, store_url: PLAY, message })).releaseNotes, [], JSON.stringify(message));
  }
});

/* Backend message → bullet points ---------------------------------------------- */

test("each sentence ending in '.' is one point, punctuation kept", () => {
  assert.deepEqual(messagePoints("changing ui. new updates. notification implementation."), ["changing ui.", "new updates.", "notification implementation."]);
});

test("trimmed; empty, repeated and punctuation-only separators never make empty bullets", () => {
  assert.deepEqual(messagePoints("  first.   second.  "), ["first.", "second."]);
  assert.deepEqual(messagePoints("first.. second. . . third"), ["first..", "second.", "third"]);
  assert.deepEqual(messagePoints(". . ."), []);
  assert.deepEqual(messagePoints("..."), []);
  assert.deepEqual(messagePoints(""), []);
  assert.deepEqual(messagePoints("no period at all"), ["no period at all"]);
});

test("periods inside versions, domains and decimals do not split a point", () => {
  assert.deepEqual(messagePoints("Update to 2.5.0 now. Visit lfa-ticketing.com for help. Fees drop 1.5%."), [
    "Update to 2.5.0 now.",
    "Visit lfa-ticketing.com for help.",
    "Fees drop 1.5%.",
  ]);
});

test("line breaks act as whitespace after a period and collapse inside a point", () => {
  assert.deepEqual(messagePoints("Faster seats.\nNew\n  checkout.\r\nBug fixes."), ["Faster seats.", "New checkout.", "Bug fixes."]);
});

test("plain text only: markup is kept as text, never interpreted", () => {
  assert.deepEqual(messagePoints("<b>Bold</b> claim. Next."), ["<b>Bold</b> claim.", "Next."]);
});

test("bounded to 12 points", () => {
  assert.equal(messagePoints(Array.from({ length: 20 }, (_, i) => `Point ${i}.`).join(" ")).length, 12);
});

/* Dismissal ---------------------------------------------------------------------- */

test("the optional prompt dismissal is scoped to the offered version (or the unversioned offer)", () => {
  assert.equal(updateDismissKey({ kind: "available", storeUrl: PLAY, latestVersion: "1.2.0", releaseNotes: [] }), "1.2.0");
  assert.equal(updateDismissKey({ kind: "available", storeUrl: PLAY, latestVersion: null, releaseNotes: [] }), "");
  assert.equal(updateDismissKey({ kind: "required", storeUrl: PLAY, latestVersion: "1.2.0", releaseNotes: [] }), null);
  assert.equal(updateDismissKey({ kind: "none" }), null);
  const unversioned = { kind: "available", storeUrl: PLAY, latestVersion: null, releaseNotes: [] };
  assert.equal(systemState({ update: unversioned, maintenance: false, dismissedLatestVersion: null }), "updateAvailable");
  assert.equal(systemState({ update: unversioned, maintenance: false, dismissedLatestVersion: "" }), "app");
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
