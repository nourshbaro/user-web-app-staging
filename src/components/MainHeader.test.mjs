import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./MainHeader.tsx", import.meta.url);
const appUrl = new URL("../app/", import.meta.url);
const componentSource = await readFile(componentUrl, "utf8");

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return routeFiles(child);
    return entry.name.endsWith(".tsx") ? [child] : [];
  }));
  return files.flat();
}

test("MainHeader paints a theme-aware backing through the dynamic top inset", () => {
  assert.match(componentSource, /useSafeAreaInsets\(\)/);
  assert.match(componentSource, /const topInset = Math\.max\(insets\.top, 14\)/);
  assert.match(componentSource, /height: topInset/);
  assert.match(componentSource, /marginTop: -topInset/);
  assert.match(componentSource, /backgroundColor: theme\.colors\.panel/);
  assert.match(componentSource, /pointerEvents="none"/);
});

test("safe-area backing does not use fixed positioning or global status-bar configuration", () => {
  assert.doesNotMatch(componentSource, /position:\s*["']absolute["']/);
  assert.doesNotMatch(componentSource, /StatusBar/);
  assert.doesNotMatch(componentSource, /statusBarHeight/);
});

test("visible MainHeader layout and content remain present", () => {
  assert.match(componentSource, /minHeight: 76/);
  assert.match(componentSource, /marginTop: -14/);
  assert.match(componentSource, /paddingHorizontal: 22/);
  assert.match(componentSource, /paddingVertical: 11/);
  assert.match(componentSource, /lfa-logo\.png/);
  assert.match(componentSource, /<HeaderActions \/>/);
});

test("only the intended routes render MainHeader", async () => {
  const routes = [];
  for (const file of await routeFiles(appUrl)) {
    const source = await readFile(file, "utf8");
    if (source.includes("<MainHeader")) {
      routes.push(file.pathname.split("/src/app/")[1].replace(/\.tsx$/, ""));
    }
  }

  // Home, Matches and Competitions use the v3 tab headers (`TabHeader`/`BrandHeader`);
  // /tournament is now a redirect. Tickets and Profile keep MainHeader until redesigned.
  assert.deepEqual(routes.sort(), ["profile", "tickets"]);
});
