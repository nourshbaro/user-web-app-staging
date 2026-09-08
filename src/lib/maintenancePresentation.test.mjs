import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutSource = await readFile(
  new URL("../app/_layout.tsx", import.meta.url),
  "utf8",
);
const guardSource = await readFile(
  new URL("../components/maintenance/MaintenanceGuard.tsx", import.meta.url),
  "utf8",
);
const screenSource = await readFile(
  new URL("../components/maintenance/UnderConstruction503.tsx", import.meta.url),
  "utf8",
);

test("the root maintenance guard replaces the navigation tree globally", () => {
  assert.match(layoutSource, /<MaintenanceGuard>[\s\S]*<Stack/);
  assert.match(layoutSource, /<\/Stack>[\s\S]*<\/MaintenanceGuard>/);
  assert.match(guardSource, /useSyncExternalStore/);
  assert.match(guardSource, /maintenance \? <UnderConstruction503 \/> : children/);
});

test("maintenance remains a static 503 presentation with no invented recovery workflow", () => {
  assert.match(screenSource, /System under construction/);
  assert.match(screenSource, /temporarily paused access/);
  assert.match(screenSource, /useSafeAreaInsets/);
  assert.match(screenSource, /useResponsive/);
  assert.match(screenSource, /useTheme/);
  assert.doesNotMatch(screenSource, /retry|poll|setInterval|AppState|apiRequest/i);
  assert.doesNotMatch(guardSource, /retry|poll|setInterval|AppState|clearSession|clearAuthentication/i);
});
