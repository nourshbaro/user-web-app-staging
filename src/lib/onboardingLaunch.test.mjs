import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decideLaunchOnboarding, resolvedInitialRouteName, serializeOnboardingCompleted } from "./onboarding.ts";
import { notificationMatchId } from "./notificationTarget.ts";

/**
 * Deterministic cold-start race coverage (Codex finding). The fake container
 * ref reproduces what Expo Router exposes on a native cold start: before the
 * container is ready the focused route looks like Home (`index`, i.e. the
 * default "/" pathname); only the `ready` event reveals the resolved initial
 * destination.
 */
function coldStart({ apparent = "index", resolved, readyAtStart = false }) {
  let ready = readyAtStart;
  let current = readyAtStart ? resolved : apparent;
  let listeners = [];
  const ref = {
    isReady: () => ready,
    addListener(event, callback) {
      assert.equal(event, "ready");
      listeners.push(callback);
      return () => {
        listeners = listeners.filter((listener) => listener !== callback);
      };
    },
    getCurrentRoute: () => (current ? { name: current } : undefined),
  };
  return {
    ref,
    /** The container mounts its resolved initial state and becomes ready. */
    resolve() {
      ready = true;
      current = resolved;
      for (const listener of [...listeners]) listener();
    },
    navigate(name) {
      current = name;
    },
    listenerCount: () => listeners.length,
  };
}

/** Lets every pending microtask/promise step run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function deps(navigation, overrides = {}) {
  return {
    platform: "android",
    isAuthenticated: false,
    pushRuntimeSupported: true,
    readStoredFlag: async () => null,
    navigation: navigation.ref,
    readLaunchNotificationTarget: async () => null,
    readPermission: async () => "undetermined",
    ...overrides,
  };
}

/** Runs the launch check and records whether it settled before the container was ready. */
async function run(navigation, overrides) {
  let settled = null;
  const pending = decideLaunchOnboarding(deps(navigation, overrides)).then((decision) => {
    settled = decision;
    return decision;
  });
  await flush();
  const beforeReady = settled;
  navigation.resolve();
  const decision = await pending;
  return { beforeReady, decision };
}

test("1. apparent Home followed by a resolved /match/[id] never shows onboarding", async () => {
  const launch = coldStart({ resolved: "match/[id]" });
  const { beforeReady, decision } = await run(launch);
  // Nothing was decided (so nothing could be shown) while only the apparent "/" was known.
  assert.equal(beforeReady, null);
  assert.deepEqual(decision, { show: false, reason: "direct-entry" });
});

test("2. apparent Home followed by a payment/result or auth-return route never shows onboarding", async () => {
  for (const resolved of ["checkout/success", "checkout/failed", "checkout/blue/success", "checkout/blue/failed", "checkout/card/payment", "checkout", "auth", "cart", "tickets"]) {
    const launch = coldStart({ resolved });
    const { beforeReady, decision } = await run(launch);
    assert.equal(beforeReady, null, resolved);
    assert.deepEqual(decision, { show: false, reason: "direct-entry" }, resolved);
  }
});

test("3. a genuinely resolved Home launch shows onboarding to an eligible signed-out first-time user", async () => {
  const launch = coldStart({ resolved: "index" });
  const { beforeReady, decision } = await run(launch);
  // Even a real Home launch waits for readiness before deciding.
  assert.equal(beforeReady, null);
  assert.deepEqual(decision, { show: true, offerNotifications: true });
  assert.equal(launch.listenerCount(), 0, "the ready listener is removed");
  // Pre-prompt only while the OS can still ask.
  const granted = await run(coldStart({ resolved: "index" }), { readPermission: async () => "granted" });
  assert.deepEqual(granted.decision, { show: true, offerNotifications: false });
  const expoGo = await run(coldStart({ resolved: "index" }), { pushRuntimeSupported: false });
  assert.deepEqual(expoGo.decision, { show: true, offerNotifications: false });
});

test("4. completed onboarding never shows (and does not wait on navigation)", async () => {
  const launch = coldStart({ resolved: "index" });
  const decision = await decideLaunchOnboarding(deps(launch, { readStoredFlag: async () => serializeOnboardingCompleted() }));
  assert.deepEqual(decision, { show: false, reason: "completed" });
  assert.equal(launch.listenerCount(), 0);
});

test("5. a signed-in user never gets onboarding", async () => {
  const launch = coldStart({ resolved: "index" });
  const decision = await decideLaunchOnboarding(deps(launch, { isAuthenticated: true }));
  assert.deepEqual(decision, { show: false, reason: "existing-user" });
});

test("a launch notification that opens a match is a direct entry, even though the route is still Home", async () => {
  const { beforeReady, decision } = await run(coldStart({ resolved: "index" }), { readLaunchNotificationTarget: async () => "42" });
  assert.equal(beforeReady, null);
  assert.deepEqual(decision, { show: false, reason: "direct-entry" });
  // A notification that routes nowhere does not block onboarding.
  const plain = await run(coldStart({ resolved: "index" }), { readLaunchNotificationTarget: async () => null });
  assert.deepEqual(plain.decision, { show: true, offerNotifications: true });
});

test("the tap router and the launch check share one notification-target rule", async () => {
  assert.equal(notificationMatchId({ match_id: 42 }), "42");
  assert.equal(notificationMatchId({ match_id: " 7 " }), "7");
  for (const data of [null, undefined, {}, { match_id: "" }, { match_id: "  " }, { match_id: Number.NaN }, { match_id: {} }]) {
    assert.equal(notificationMatchId(data), null, JSON.stringify(data));
  }
  const router = await readFile(new URL("./notificationNavigation.ts", import.meta.url), "utf8");
  assert.match(router, /const matchId = notificationMatchId\(data\);/);
  assert.match(router, /router\.push\(\{\s*pathname: "\/match\/\[id\]",\s*params: \{\s*id: matchId,/);
});

test("navigation away from Home while the launch resolves wins", async () => {
  const launch = coldStart({ resolved: "index" });
  const decision = await run(launch, {
    readPermission: async () => {
      launch.navigate("match/[id]");
      return "undetermined";
    },
  });
  assert.deepEqual(decision.decision, { show: false, reason: "direct-entry" });
});

test("an already-ready container resolves immediately from its resolved route", async () => {
  const launch = coldStart({ resolved: "match/[id]", readyAtStart: true });
  assert.equal(await resolvedInitialRouteName(launch.ref), "match/[id]");
  assert.equal(launch.listenerCount(), 0);
  const home = coldStart({ resolved: "index", readyAtStart: true });
  assert.deepEqual(await decideLaunchOnboarding(deps(home)), { show: true, offerNotifications: true });
});

test("failures never trap the app or mark onboarding completed", async () => {
  const unreadable = await decideLaunchOnboarding(deps(coldStart({ resolved: "index" }), {
    readStoredFlag: async () => {
      throw new Error("storage");
    },
  }));
  assert.deepEqual(unreadable, { show: false, reason: "unreadable" });
  const notification = await run(coldStart({ resolved: "index" }), {
    readLaunchNotificationTarget: async () => {
      throw new Error("notifications");
    },
  });
  assert.deepEqual(notification.decision, { show: false, reason: "unresolved" });
  // Permission read failure: still a Home launch, just no pre-prompt.
  const permission = await run(coldStart({ resolved: "index" }), {
    readPermission: async () => {
      throw new Error("permission");
    },
  });
  assert.deepEqual(permission.decision, { show: true, offerNotifications: false });
});

test("web never waits on navigation", async () => {
  const launch = coldStart({ resolved: "index" });
  assert.deepEqual(await decideLaunchOnboarding(deps(launch, { platform: "web" })), { show: false, reason: "web" });
  assert.equal(launch.listenerCount(), 0);
});

test("the gate shows onboarding only from the final launch decision, never from the early pathname", async () => {
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const gate = strip(await readFile(new URL("../hooks/useOnboardingGate.ts", import.meta.url), "utf8"));
  // The only transition to "visible" is the settled decision.
  assert.doesNotMatch(gate, /setState\("visible"\)/);
  assert.equal(gate.match(/setState\([^)]*"visible"/g)?.length, 1);
  assert.match(gate, /setState\(decision\.show \? "visible" : "hidden"\);/);
  assert.match(gate, /navigation: navigationRef,/);
  assert.match(gate, /const navigationRef = useNavigationContainerRef\(\);/);
  assert.match(gate, /readLaunchNotificationTarget: async \(\) => notificationMatchId\(await getInitialNotificationData\(\)\),/);
  // The pathname is used only to step aside after showing, not to decide.
  assert.doesNotMatch(gate, /pathnameRef|decideOnboarding\(/);
  // Read-only use of navigation: the gate never navigates or rewrites links.
  assert.doesNotMatch(gate, /navigationRef\.(navigate|dispatch|reset|resetRoot|goBack)|router\.|Linking\./);
  // Bypass is not completion; only an existing user or finishing writes the flag.
  assert.equal(gate.match(/storage\.set\(ONBOARDING_STORAGE_KEY/g)?.length, 2);
  assert.match(gate, /decision\.reason === "existing-user"/);
});
