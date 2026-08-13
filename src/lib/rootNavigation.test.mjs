import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uiSource = await readFile(
  new URL("../components/ui.tsx", import.meta.url),
  "utf8",
);
const layoutSource = await readFile(
  new URL("../app/_layout.tsx", import.meta.url),
  "utf8",
);

function extractBottomNavigation() {
  const match = uiSource.match(
    /function BottomNavigation[\s\S]*?(?=\nexport function useResponsive)/,
  );

  assert.ok(match, "BottomNavigation implementation was not found.");
  return match[0];
}

function findScreenDeclaration(routeName) {
  const declaration = layoutSource
    .split(/\r?\n/)
    .find((line) => line.includes(`<Stack.Screen name="${routeName}"`));

  assert.ok(declaration, `Stack.Screen declaration for ${routeName} was not found.`);
  return declaration;
}

test("bottom navigation ignores the active root and replaces a different root", () => {
  const bottomNavigation = extractBottomNavigation();

  for (const [label, href] of [
    ["Home", "/"],
    ["Tournament", "/tournament"],
    ["Matches", "/matches"],
    ["Profile", "/profile"],
  ]) {
    assert.match(
      bottomNavigation,
      new RegExp(`label: "${label}", href: "${href.replace("/", "\\/")}"`),
    );
  }
  assert.match(
    bottomNavigation,
    /const active = tab\.href === "\/" \? pathname === "\/" : pathname\.startsWith\(tab\.href\);/,
  );
  assert.match(
    bottomNavigation,
    /onPress=\{\(\) => \{\s*if \(active\) return;\s*router\.replace\(tab\.href as any\);\s*\}\}/,
  );
  assert.doesNotMatch(bottomNavigation, /router\.push\(/);
});

test("all four primary root screens disable stack animation", () => {
  for (const routeName of ["index", "matches", "tournament", "profile"]) {
    const declaration = findScreenDeclaration(routeName);

    assert.match(declaration, /headerShown:\s*false/);
    assert.match(declaration, /animation:\s*"none"/);
  }
});

test("animation is not disabled in global Stack screenOptions", () => {
  const screenOptions = layoutSource.match(
    /screenOptions=\{\{[\s\S]*?\}\}\s*>/,
  );

  assert.ok(screenOptions, "Root Stack screenOptions were not found.");
  assert.doesNotMatch(screenOptions[0], /animation:\s*"none"/);
});

test("detail and action screens retain their existing transition configuration", () => {
  for (const routeName of ["auth", "cart", "checkout", "match/[id]"]) {
    const declaration = findScreenDeclaration(routeName);

    assert.match(declaration, /headerShown:\s*false/);
    assert.doesNotMatch(declaration, /\banimation\s*:/);
  }
});
