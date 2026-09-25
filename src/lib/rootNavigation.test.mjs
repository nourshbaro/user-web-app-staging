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
const authContextSource = await readFile(
  new URL("../context/AuthContext.tsx", import.meta.url),
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
  const declaration = [...layoutSource.matchAll(/<Stack\.Screen\s+name="([^"]+)"[\s\S]*?\/>/g)]
    .find((match) => match[1] === routeName)?.[0];

  assert.ok(declaration, `Stack.Screen declaration for ${routeName} was not found.`);
  return declaration;
}

test("bottom navigation ignores the active root and replaces a different root", () => {
  const bottomNavigation = extractBottomNavigation();

  for (const [labelKey, href] of [
    ["nav.home", "/"],
    ["nav.tournament", "/tournament"],
    ["nav.matches", "/matches"],
    ["nav.tickets", "/tickets"],
    ["nav.profile", "/profile"],
  ]) {
    assert.match(
      bottomNavigation,
      new RegExp(`labelKey: "${labelKey.replace(".", "\\.")}", href: "${href.replace("/", "\\/")}"`),
    );
  }
  assert.match(
    bottomNavigation,
    /const active = tab\.href === "\/" \? pathname === "\/" : pathname\.startsWith\(tab\.href\);/,
  );
  assert.match(
    bottomNavigation,
    /onPress=\{\(\) => \{\s*if \(active\) return;\s*onNavigate\(tab\.href\);\s*\}\}/,
  );
  assert.doesNotMatch(bottomNavigation, /router\.push\(/);
  const navigateToTab = uiSource.match(/const navigateToTab = useCallback\([\s\S]*?\}, \[pathname\]\);/)?.[0];
  assert.ok(navigateToTab, "navigateToTab implementation was not found.");
  assert.match(navigateToTab, /if \(destination === pathname\) return;/);
  assert.match(navigateToTab, /router\.replace\(destination\);/);
  assert.doesNotMatch(navigateToTab, /router\.push\(/);
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

test("password-change success clears auth and leaves Login above public Home", () => {
  const changePassword = authContextSource.match(
    /const changePassword = useCallback\([\s\S]*?\}, \[clearSessionState\]\);/,
  );

  assert.ok(changePassword, "Change Password auth flow was not found.");
  assert.match(changePassword[0], /clearSessionState\(\)/);
  assert.match(changePassword[0], /await authService\.clearSession\(\)/);
  assert.doesNotMatch(changePassword[0], /authService\.logout\(\)/);
  assert.match(changePassword[0], /dismissAll\?\.\(\)/);
  assert.match(changePassword[0], /router\.replace\("\/"\)/);
  assert.match(changePassword[0], /router\.push\("\/auth"\)/);
  assert.ok(
    changePassword[0].indexOf('router.replace("/")') <
      changePassword[0].indexOf('router.push("/auth")'),
  );
});
