import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { typography } from "./designTokens.ts";
import { fontFamilyFor, fontStyleFor, LATIN_FONT_FAMILIES } from "./fontFamilies.ts";

test("text roles use IBM Plex Sans and display roles use Barlow Condensed, weight-matched", () => {
  assert.equal(fontFamilyFor("text", "400", "latin", true), "IBMPlexSans_400Regular");
  assert.equal(fontFamilyFor("text", "600", "latin", true), "IBMPlexSans_600SemiBold");
  // Heavier requests clamp to the heaviest bundled file.
  assert.equal(fontFamilyFor("text", "900", "latin", true), "IBMPlexSans_700Bold");
  assert.equal(fontFamilyFor("display", "700", "latin", true), "BarlowCondensed_700Bold");
  assert.equal(fontFamilyFor("display", "400", "latin", true), "BarlowCondensed_500Medium");
});

test("Arabic never resolves to a Latin family (Barlow is not the Arabic dependency)", () => {
  for (const role of ["text", "display"]) {
    for (const weight of ["400", "500", "600", "700", "800", "900"]) {
      assert.equal(fontFamilyFor(role, weight, "arabic", true), null, `${role} ${weight}`);
    }
  }
});

test("until fonts load (or if loading fails) text uses the platform font with its weight", () => {
  assert.equal(fontFamilyFor("text", "700", "latin", false), null);
  assert.deepEqual(fontStyleFor("text", "700", "latin", false), { fontWeight: "700" });
  // A resolved family carries its own weight (no synthetic bold).
  assert.deepEqual(fontStyleFor("text", "700", "latin", true), { fontFamily: "IBMPlexSans_700Bold" });
});

test("Barlow Condensed is selective: only display variants use it", () => {
  const display = Object.entries(typography).filter(([, token]) => token.family === "display").map(([name]) => name).sort();
  assert.deepEqual(display, ["displayCountdown", "displayKickoff", "displayNumeral", "displaySection", "displayTitle"]);
  for (const name of ["body", "bodyStrong", "meta", "label", "caption", "action", "cardTitle"]) {
    assert.equal(typography[name].family, undefined, name);
  }
});

test("family names live only in the typography system, never in screens", async () => {
  const root = new URL("../", import.meta.url);
  const allowed = new Set(["lib/fontFamilies.ts", "hooks/useAppFonts.ts"]);
  const names = [...Object.values(LATIN_FONT_FAMILIES.text), ...Object.values(LATIN_FONT_FAMILIES.display)];
  const files = (await readdir(root, { recursive: true }))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /\.tsx?$/.test(file) && !allowed.has(file));
  for (const file of files) {
    const text = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(text, /fontFamily:\s*["']/, `${file} sets a literal fontFamily`);
    for (const name of names) assert.equal(text.includes(name), false, `${file} names ${name}`);
  }
});

test("fonts load through expo-font (runtime), only the used weights, and never block the app on failure", async () => {
  const hook = await readFile(new URL("../hooks/useAppFonts.ts", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/_layout.tsx", import.meta.url), "utf8");
  assert.match(hook, /const \[loaded, error\] = useFonts\(FONT_FILES\);/);
  assert.match(hook, /setCustomFontsLoaded\(loaded && !error\);/);
  assert.match(hook, /return loaded \|\| Boolean\(error\);/);
  assert.equal(hook.match(/from "@expo-google-fonts\/[a-z-]+\/\d{3}\w+";/g)?.length, 7);
  assert.match(layout, /const fontsSettled = useAppFonts\(\);/);
  assert.match(layout, /if \(!isReady \|\| !fontsSettled\) \{\s*return null;/);
});
