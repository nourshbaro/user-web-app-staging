import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { navigationBackGlyph } from "../i18n/direction.ts";
import { flowHeaderLayout, headerPlatform } from "./flowHeaderPresentation.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("platform detection: Android gets the Android variant; iOS and web the iOS one", () => {
  assert.equal(headerPlatform("android"), "android");
  assert.equal(headerPlatform("ios"), "ios");
  assert.equal(headerPlatform("web"), "ios");
});

test("v3 chpw (and Settings, Legal, Contact, Cart): iOS red chevron + 'Profile' + centred mixed-case title", () => {
  assert.deepEqual(flowHeaderLayout("ios", { title: "Change password", backLabel: "Profile" }), {
    backGlyph: "chevron",
    backTone: "brand",
    backLabel: "Profile",
    title: { text: "Change password", placement: "center", style: "plain" },
    subtitle: null,
  });
});

test("v3 chpw on Android: ink arrow, no back label, start-aligned display title", () => {
  assert.deepEqual(flowHeaderLayout("android", { title: "Change password", backLabel: "Profile" }), {
    backGlyph: "arrow",
    backTone: "strong",
    backLabel: null,
    title: { text: "Change password", placement: "start", style: "display" },
    subtitle: null,
  });
});

test("v3 holders / checkout / ticket: no header title on iOS, the display title on Android", () => {
  const ios = flowHeaderLayout("ios", { title: "Ticket holders", backLabel: "Cart", titleOnIos: false });
  assert.equal(ios.title, null);
  assert.equal(ios.backLabel, "Cart");
  const android = flowHeaderLayout("android", { title: "Ticket holders", backLabel: "Cart", titleOnIos: false });
  assert.deepEqual(android.title, { text: "Ticket holders", placement: "start", style: "display" });
});

test("v3 seats: iOS centred title + detail; Android plain 20pt title + detail", () => {
  const options = { title: "Zone A", subtitle: "Ansar v Mabarrah", backLabel: "Match", androidTitle: "plain" };
  assert.deepEqual(flowHeaderLayout("ios", options).title, { text: "Zone A", placement: "center", style: "plain" });
  assert.equal(flowHeaderLayout("ios", options).subtitle, "Ansar v Mabarrah");
  assert.deepEqual(flowHeaderLayout("android", options).title, { text: "Zone A", placement: "start", style: "plainLarge" });
  assert.equal(flowHeaderLayout("android", options).subtitle, "Ansar v Mabarrah");
});

test("v3 notifs / delete_verify / auth steps: back only (iOS keeps its label), no title on either platform", () => {
  assert.deepEqual(flowHeaderLayout("ios", { title: "", backLabel: "Home" }), {
    backGlyph: "chevron", backTone: "brand", backLabel: "Home", title: null, subtitle: null,
  });
  assert.deepEqual(flowHeaderLayout("android", { title: "", backLabel: "Home" }), {
    backGlyph: "arrow", backTone: "strong", backLabel: null, title: null, subtitle: null,
  });
});

test("the navigation back glyph: iOS chevron, Android arrow, both mirrored in RTL", () => {
  assert.deepEqual(navigationBackGlyph("ios", false), { ios: "chevron.left", android: "chevron_left", web: "chevron_left" });
  assert.deepEqual(navigationBackGlyph("ios", true), { ios: "chevron.right", android: "chevron_right", web: "chevron_right" });
  assert.deepEqual(navigationBackGlyph("android", false), { ios: "arrow.left", android: "arrow_back", web: "arrow_back" });
  assert.deepEqual(navigationBackGlyph("android", true), { ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" });
});

test("the shared header and hero back buttons take the platform presentation (one owner)", async () => {
  const header = await read("../components/FlowHeader.tsx");
  assert.match(header, /const platform = headerPlatform\(Platform\.OS\);/);
  assert.match(header, /const layout = flowHeaderLayout\(platform, \{ title, subtitle, backLabel, titleOnIos, androidTitle \}\);/);
  assert.match(header, /<NavigationBackGlyph size=\{layout\.backGlyph === "chevron" \? 20 : 24\} color=\{tint\} \/>/);
  assert.match(header, /variant=\{display \? "displaySection" : "body"\}/);
  for (const path of ["../components/match/MatchDetailHero.tsx", "../components/match/MatchInfoView.tsx"]) {
    const hero = await read(path);
    assert.match(hero, /<NavigationBackGlyph size=\{22\} color=\{theme\.colors\.onHero\} \/>/, path);
    assert.doesNotMatch(hero, /DirectionalChevron kind="back"/, path);
  }
});

test("screens opt into their v3 header pattern only (no per-screen platform checks)", async () => {
  for (const path of ["../app/checkout/ticket-holders.tsx", "../app/checkout.tsx", "../app/tickets.tsx"]) {
    assert.match(await read(path), /titleOnIos=\{false\}/, path);
  }
  assert.match(await read("../app/match/[id].tsx"), /androidTitle="plain"/);
  // The ticket position moved to the trailing slot so it stays visible where iOS shows no title.
  const tickets = await read("../app/tickets.tsx");
  assert.match(tickets, /trailing=\{\s*total > 1 \? \(/);
  for (const path of ["../components/SubpageShell.tsx", "../app/notifications.tsx"]) {
    assert.doesNotMatch(await read(path), /Platform\.OS/, path);
  }
  // The account shell's only platform branch is the keyboard behaviour, not the header.
  const shell = await read("../components/account/AccountFormShell.tsx");
  assert.equal((shell.match(/Platform\.OS/g) ?? []).length, 1);
  assert.match(shell, /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/);
});
