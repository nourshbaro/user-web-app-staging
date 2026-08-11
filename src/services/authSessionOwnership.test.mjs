import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const apiSource = await readFile(new URL("./api.ts", import.meta.url), "utf8");
const authSource = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
const authoritySource = await readFile(new URL("../lib/authSessionOwnership.ts", import.meta.url), "utf8");

const toModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function createHarness() {
  const key = `__authOwnership_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const state = {
    values: new Map(),
    fetches: [],
    notifications: 0,
    removeCount: 0,
    failGet: false,
    failGetKeys: new Set(),
    failRemove: false,
    failRemoveKeys: new Set(),
    getGates: new Map(),
    getStarted: new Map(),
    removeGate: null,
    removeStarted: null,
    removeGates: new Map(),
    removeStartedByKey: new Map(),
    fetch(request, init) {
      const pending = deferred();
      this.fetches.push({ request, init, pending });
      return pending.promise;
    },
  };
  globalThis[key] = state;

  const storageUrl = toModuleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const storage = {
            async get(key) {
        const started = state.getStarted.get(key);
        if (started) started.resolve();

        const gate = state.getGates.get(key);
        if (gate) await gate.promise;

        if (state.failGet || state.failGetKeys.has(key)) {
          throw new Error(\`storage get failed: \${key}\`);
        }

        return state.values.get(key) ?? null;
      },
      async set(key, value) {
        state.values.set(key, value);
      },
      async remove(key) {
        state.removeCount += 1;

        if (state.removeStarted) state.removeStarted.resolve();

        const keyedStarted = state.removeStartedByKey.get(key);
        if (keyedStarted) keyedStarted.resolve();

        if (state.removeGate) await state.removeGate.promise;

        const keyedGate = state.removeGates.get(key);
        if (keyedGate) await keyedGate.promise;

       if (state.failRemove || state.failRemoveKeys.has(key)) {
          throw new Error("storage remove failed: ${key}");
        }

        state.values.delete(key);
      },
    };
  `);
  const configUrl = toModuleUrl(`export const config = {
    timeoutMs: 15000,
    apiBaseUrl: "https://api.example.test",
    apiPassword: "public-password",
  };`);
  const reactNativeUrl = toModuleUrl(`export const Platform = { OS: "web" };`);
  const authorityUrl = toModuleUrl(transpile(authoritySource));

  const executableApi = transpile(apiSource)
    .replace('from "@/lib/config"', `from ${JSON.stringify(configUrl)}`)
    .replace('from "@/lib/authSessionOwnership"', `from ${JSON.stringify(authorityUrl)}`)
    .replace('from "@/lib/storage"', `from ${JSON.stringify(storageUrl)}`)
    .replace('from "react-native"', `from ${JSON.stringify(reactNativeUrl)}`)
    .replaceAll("await fetch(", `await globalThis[${JSON.stringify(key)}].fetch(`);
  const apiUrl = toModuleUrl(executableApi);
  const api = await import(apiUrl);

  const executableAuth = transpile(authSource)
    .replace('from "react-native"', `from ${JSON.stringify(reactNativeUrl)}`)
    .replace('from "@/lib/config"', `from ${JSON.stringify(configUrl)}`)
    .replace('from "@/services/api"', `from ${JSON.stringify(apiUrl)}`)
    .replace('from "@/lib/storage"', `from ${JSON.stringify(storageUrl)}`)
    .replaceAll("await fetch(", `await globalThis[${JSON.stringify(key)}].fetch(`);
  const auth = await import(toModuleUrl(executableAuth));
  const unsubscribe = api.onUnauthenticated(() => {
    state.notifications += 1;
  });

  return {
    api,
    auth,
    state,
    async waitForFetch(count = 1) {
      while (state.fetches.length < count) await Promise.resolve();
      return state.fetches[count - 1];
    },
    cleanup() {
      unsubscribe();
      delete globalThis[key];
    },
  };
}

async function install(harness, token, user = token) {
  await harness.api.setToken(token);
  harness.state.values.set("lfa_portal_user", JSON.stringify({ id: user }));
}

async function staleFailureDoesNotClearReplacement(status) {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const request = harness.api.apiRequest("/portal/orders");
    const pending = await harness.waitForFetch();
    await install(harness, "token-b", "B");
    pending.pending.resolve(response(status, { message: "old session rejected" }));
    await assert.rejects(request, (error) => error.status === status);
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-b");
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
}

test("stale 401 cannot clear a replacement session", () => staleFailureDoesNotClearReplacement(401));
test("stale 403 cannot clear a replacement session", () => staleFailureDoesNotClearReplacement(403));

for (const status of [401, 403]) {
  test(`current-session ${status} clears once and notifies once`, async () => {
    const harness = await createHarness();
    try {
      await install(harness, "token-a", "A");
      const request = harness.api.apiRequest("/portal/orders");
      const pending = await harness.waitForFetch();
      pending.pending.resolve(response(status, { message: "current session rejected" }));
      await assert.rejects(request, (error) => error.status === status);
      assert.equal(harness.state.values.has("lfa_portal_token"), false);
      assert.equal(harness.state.notifications, 1);
    } finally {
      harness.cleanup();
    }
  });
}

test("multiple failures from a replaced session leave the replacement untouched", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const first = harness.api.apiRequest("/portal/orders");
    const second = harness.api.apiRequest("/portal/tickets");
    await harness.waitForFetch(2);
    await install(harness, "token-b", "B");
    harness.state.fetches[0].pending.resolve(response(401));
    harness.state.fetches[1].pending.resolve(response(403));
    await Promise.allSettled([first, second]);
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-b");
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
});

test("simultaneous current-generation failures produce one invalidation", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const first = harness.api.apiRequest("/portal/orders");
    const second = harness.api.apiRequest("/portal/tickets");
    await harness.waitForFetch(2);
    harness.state.fetches[0].pending.resolve(response(401));
    harness.state.fetches[1].pending.resolve(response(403));
    await Promise.allSettled([first, second]);
    assert.equal(harness.state.notifications, 1);
    assert.equal(harness.state.removeCount, 1);
  } finally {
    harness.cleanup();
  }
});

test("same token string in a newer generation survives an old failure", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-x", "A");
    const request = harness.api.apiRequest("/portal/orders");
    const pending = await harness.waitForFetch();
    await install(harness, "token-x", "B");
    pending.pending.resolve(response(401));
    await assert.rejects(request);
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-x");
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
});

test("replacement during asynchronous invalidation suppresses the stale notification", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const request = harness.api.apiRequest("/portal/orders");
    const pending = await harness.waitForFetch();
    harness.state.removeGate = deferred();
    harness.state.removeStarted = deferred();
    pending.pending.resolve(response(401));
    await harness.state.removeStarted.promise;
    const replacement = harness.api.setToken("token-b");
    harness.state.removeGate.resolve();
    await replacement;
    await assert.rejects(request);
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-b");
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
});

test("storage failure during invalidation preserves the original API error and emits nothing", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const request = harness.api.apiRequest("/portal/orders");
    const pending = await harness.waitForFetch();
    harness.state.failRemove = true;
    pending.pending.resolve(response(401, { message: "original unauthorized" }));
    await assert.rejects(request, (error) => error.status === 401 && error.message === "original unauthorized");
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-a");
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
});

test("ownership lookup failure starts no request and invalidates nothing", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    harness.state.failGet = true;
    await assert.rejects(harness.api.apiRequest("/portal/orders"), /storage get failed/);
    assert.equal(harness.state.fetches.length, 0);
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-a");
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
});

for (const status of [401, 403]) {
  test(`PDF stale ${status} preserves the replacement session`, async () => {
    const harness = await createHarness();
    try {
      await install(harness, "token-a", "A");
      const request = harness.auth.profileService.orderPdf("order-1");
      const pending = await harness.waitForFetch();
      await install(harness, "token-b", "B");
      pending.pending.resolve(response(status, { message: "old PDF rejected" }));
      await assert.rejects(request, /old PDF rejected/);
      assert.equal(harness.state.values.get("lfa_portal_token"), "token-b");
      assert.equal(harness.state.notifications, 0);
    } finally {
      harness.cleanup();
    }
  });
}

test("stale logout completion cannot clear a replacement login", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const logout = harness.auth.authService.logout();
    const pending = await harness.waitForFetch();
    await logout;
    assert.equal(harness.state.values.has("lfa_portal_token"), false);
    assert.equal(harness.state.values.has("lfa_portal_user"), false);
    assert.equal(pending.init.headers.Authorization, "Bearer token-a");
    await harness.auth.authService.saveSession({ token: "token-b", user: { id: "B" } });
    pending.pending.resolve(response(200));
    await Promise.resolve();
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-b");
    assert.deepEqual(JSON.parse(harness.state.values.get("lfa_portal_user")), { id: "B" });
  } finally {
    harness.cleanup();
  }
});

test("normal logout still clears its token and persisted user", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const logout = harness.auth.authService.logout();
    const pending = await harness.waitForFetch();
    await logout;
    assert.equal(harness.state.values.has("lfa_portal_token"), false);
    assert.equal(harness.state.values.has("lfa_portal_user"), false);
    pending.pending.resolve(response(200));
    await Promise.resolve();
    assert.equal(harness.state.values.has("lfa_portal_token"), false);
    assert.equal(harness.state.values.has("lfa_portal_user"), false);
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
});

test("logout immediately exposes an unauthenticated snapshot before the server responds", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const logout = harness.auth.authService.logout();
    const pending = await harness.waitForFetch();
    await logout;
    const authentication = await harness.api.captureAuthenticationSnapshot();
    assert.equal(authentication.token, null);
    assert.equal(harness.state.values.has("lfa_portal_user"), false);
    pending.pending.resolve(response(200));
    await Promise.resolve();
  } finally {
    harness.cleanup();
  }
});

test("a restoration snapshot captured before logout cannot republish A", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const staleRestoration = await harness.api.captureAuthenticationSnapshot();
    const logout = harness.auth.authService.logout();
    const pending = await harness.waitForFetch();
    await logout;
    assert.equal(harness.api.isAuthenticationSnapshotCurrent(staleRestoration), false);
    assert.equal((await harness.api.captureAuthenticationSnapshot()).token, null);
    pending.pending.resolve(response(200));
    await Promise.resolve();
  } finally {
    harness.cleanup();
  }
});

test("skipUnauthenticatedNotify preserves its existing no-invalidation behavior", async () => {
  const harness = await createHarness();
  try {
    await install(harness, "token-a", "A");
    const request = harness.api.apiRequest("/auth/login", { skipUnauthenticatedNotify: true });
    const pending = await harness.waitForFetch();
    pending.pending.resolve(response(401));
    await assert.rejects(request, (error) => error.status === 401);
    assert.equal(harness.state.values.get("lfa_portal_token"), "token-a");
    assert.equal(harness.state.notifications, 0);
  } finally {
    harness.cleanup();
  }
});

test("malformed persisted user clears current token and user authority", async () => {
  const harness = await createHarness();

  try {
    await harness.api.setToken("token-a");
    harness.state.values.set("lfa_portal_user", "{not-json");

    const restoration = await harness.auth.authService.restoreSession();

    assert.equal(restoration.status, "invalid");
    assert.equal(harness.state.values.has("lfa_portal_token"), false);
    assert.equal(harness.state.values.has("lfa_portal_user"), false);

    const request = harness.api.apiRequest("/cart");
    const pending = await harness.waitForFetch();

    assert.equal(pending.init.headers.Authorization, undefined);

    pending.pending.resolve(response(200, { data: [] }));
    await request;
  } finally {
    harness.cleanup();
  }
});

test("token without a user clears both persisted authentication records", async () => {
  const harness = await createHarness();

  try {
    await harness.api.setToken("token-a");

    const restoration = await harness.auth.authService.restoreSession();

    assert.equal(restoration.status, "invalid");
    assert.equal(harness.state.values.has("lfa_portal_token"), false);
    assert.equal(harness.state.values.has("lfa_portal_user"), false);
  } finally {
    harness.cleanup();
  }
});

test("user without a token clears both persisted authentication records", async () => {
  const harness = await createHarness();

  try {
    harness.state.values.set(
      "lfa_portal_user",
      JSON.stringify({ id: 1, email: "user@example.test" }),
    );

    const restoration = await harness.auth.authService.restoreSession();

    assert.equal(restoration.status, "invalid");
    assert.equal(harness.state.values.has("lfa_portal_token"), false);
    assert.equal(harness.state.values.has("lfa_portal_user"), false);
  } finally {
    harness.cleanup();
  }
});

test("valid token and minimally valid user restore normal transport authority", async () => {
  const harness = await createHarness();

  try {
    await harness.api.setToken("token-a");
    harness.state.values.set(
      "lfa_portal_user",
      JSON.stringify({ id: 1, name: "User A" }),
    );

    const restoration = await harness.auth.authService.restoreSession();

    assert.equal(restoration.status, "authenticated");
    assert.equal(restoration.token, "token-a");
    assert.deepEqual(restoration.user, { id: 1, name: "User A" });
    assert.equal(
      harness.api.isAuthenticationSnapshotCurrent(restoration.authentication),
      true,
    );

    const request = harness.api.apiRequest("/portal/orders");
    const pending = await harness.waitForFetch();

    assert.equal(
      pending.init.headers.Authorization,
      "Bearer token-a",
    );

    pending.pending.resolve(response(200, { data: [] }));
    await request;
  } finally {
    harness.cleanup();
  }
});

test("valid non-empty email is sufficient persisted user identity", async () => {
  const harness = await createHarness();

  try {
    await harness.api.setToken("token-a");
    harness.state.values.set(
      "lfa_portal_user",
      JSON.stringify({ email: "user@example.test" }),
    );

    const restoration = await harness.auth.authService.restoreSession();

    assert.equal(restoration.status, "authenticated");
    assert.deepEqual(restoration.user, {
      email: "user@example.test",
    });
  } finally {
    harness.cleanup();
  }
});

for (const [name, invalidUser] of [
  ["empty object", {}],
  ["array", []],
  ["string primitive", "hello"],
  ["wrong id type", { id: "1" }],
  ["wrong email type", { email: 123 }],
]) {
  test(`invalid persisted user shape is cleared: ${name}`, async () => {
    const harness = await createHarness();

    try {
      await harness.api.setToken("token-a");
      harness.state.values.set(
        "lfa_portal_user",
        JSON.stringify(invalidUser),
      );

      const restoration = await harness.auth.authService.restoreSession();

      assert.equal(restoration.status, "invalid");
      assert.equal(
        harness.state.values.has("lfa_portal_token"),
        false,
      );
      assert.equal(
        harness.state.values.has("lfa_portal_user"),
        false,
      );
    } finally {
      harness.cleanup();
    }
  });
}

test("stale restoration A cannot publish over replacement B", async () => {
  const harness = await createHarness();

  try {
    await install(harness, "token-a", 1);

    const userReadStarted = deferred();
    const userReadGate = deferred();
    harness.state.getStarted.set(
      "lfa_portal_user",
      userReadStarted,
    );
    harness.state.getGates.set(
      "lfa_portal_user",
      userReadGate,
    );

    const restorationA = harness.auth.authService.restoreSession();
    await userReadStarted.promise;

    await harness.auth.authService.saveSession({
      token: "token-b",
      user: { id: 2, email: "b@example.test" },
    });

    userReadGate.resolve();

    const resultA = await restorationA;

    assert.equal(resultA.status, "stale");
    assert.equal(
      harness.state.values.get("lfa_portal_token"),
      "token-b",
    );
    assert.deepEqual(
      JSON.parse(harness.state.values.get("lfa_portal_user")),
      { id: 2, email: "b@example.test" },
    );
  } finally {
    harness.cleanup();
  }
});

test("malformed A cleanup cannot clear replacement B", async () => {
  const harness = await createHarness();

  try {
    await harness.api.setToken("token-a");
    harness.state.values.set("lfa_portal_user", "{not-json");

    const userRemovalStarted = deferred();
    const userRemovalGate = deferred();

    harness.state.removeStartedByKey.set(
      "lfa_portal_user",
      userRemovalStarted,
    );
    harness.state.removeGates.set(
      "lfa_portal_user",
      userRemovalGate,
    );

    const restorationA = harness.auth.authService.restoreSession();
    await userRemovalStarted.promise;

    const replacementB = harness.auth.authService.saveSession({
      token: "token-b",
      user: { id: 2, email: "b@example.test" },
    });

    userRemovalGate.resolve();

    const [resultA] = await Promise.all([
      restorationA,
      replacementB,
    ]);

    assert.equal(resultA.status, "stale");
    assert.equal(
      harness.state.values.get("lfa_portal_token"),
      "token-b",
    );
    assert.deepEqual(
      JSON.parse(harness.state.values.get("lfa_portal_user")),
      { id: 2, email: "b@example.test" },
    );
  } finally {
    harness.cleanup();
  }
});

for (const failedKey of [
  "lfa_portal_token",
  "lfa_portal_user",
]) {
  test(`storage read failure remains fail-closed after recovery: ${failedKey}`, async () => {
    const harness = await createHarness();

    try {
      await install(harness, "token-a", 1);
      harness.state.failGetKeys.add(failedKey);

      const restoration = await harness.auth.authService.restoreSession();

      assert.equal(restoration.status, "storage-error");
      assert.equal(
        harness.api.isAuthenticationSnapshotCurrent(
          restoration.authentication,
        ),
        true,
      );

      assert.equal(
        harness.state.values.get("lfa_portal_token"),
        "token-a",
      );
      assert.deepEqual(
        JSON.parse(
          harness.state.values.get("lfa_portal_user"),
        ),
        { id: 1 },
      );
      assert.equal(harness.state.removeCount, 0);

      harness.state.failGetKeys.delete(failedKey);

      const request = harness.api.apiRequest("/cart");
      const pending = await harness.waitForFetch();

      assert.equal(
        pending.init.headers.Authorization,
        undefined,
      );

      pending.pending.resolve(response(200, { data: [] }));
      await request;
    } finally {
      harness.cleanup();
    }
  });
}

test("token cleanup failure cannot revive invalid transport authority", async () => {
  const harness = await createHarness();

  try {
    await harness.api.setToken("token-a");
    harness.state.values.set(
      "lfa_portal_user",
      "{not-json",
    );
    harness.state.failRemoveKeys.add("lfa_portal_token");

    const restoration = await harness.auth.authService.restoreSession();

    assert.equal(restoration.status, "storage-error");
    assert.equal(
      harness.state.values.get("lfa_portal_token"),
      "token-a",
    );
    assert.equal(
      harness.state.values.has("lfa_portal_user"),
      false,
    );

    harness.state.failRemoveKeys.delete("lfa_portal_token");

    const request = harness.api.apiRequest("/cart");
    const pending = await harness.waitForFetch();

    assert.equal(
      pending.init.headers.Authorization,
      undefined,
    );

    pending.pending.resolve(response(200, { data: [] }));
    await request;
  } finally {
    harness.cleanup();
  }
});

test("user cleanup failure remains fail-closed after token-first removal", async () => {
  const harness = await createHarness();

  try {
    await harness.api.setToken("token-a");
    harness.state.values.set(
      "lfa_portal_user",
      "{not-json",
    );
    harness.state.failRemoveKeys.add("lfa_portal_user");

    const restoration = await harness.auth.authService.restoreSession();

    assert.equal(restoration.status, "storage-error");
    assert.equal(
      harness.state.values.has("lfa_portal_token"),
      false,
    );
    assert.equal(
      harness.state.values.get("lfa_portal_user"),
      "{not-json",
    );

    harness.state.failRemoveKeys.delete("lfa_portal_user");

    const request = harness.api.apiRequest("/cart");
    const pending = await harness.waitForFetch();

    assert.equal(
      pending.init.headers.Authorization,
      undefined,
    );

    pending.pending.resolve(response(200, { data: [] }));
    await request;
  } finally {
    harness.cleanup();
  }
});

test("replacement login B lifts fail-closed restoration A", async () => {
  const harness = await createHarness();

  try {
    await install(harness, "token-a", 1);
    harness.state.failGetKeys.add("lfa_portal_user");

    const restorationA = await harness.auth.authService.restoreSession();

    assert.equal(restorationA.status, "storage-error");

    harness.state.failGetKeys.delete("lfa_portal_user");

    await harness.auth.authService.saveSession({
      token: "token-b",
      user: { id: 2, email: "b@example.test" },
    });

    const requestB = harness.api.apiRequest("/portal/orders");
    const pendingB = await harness.waitForFetch();

    assert.equal(
      pendingB.init.headers.Authorization,
      "Bearer token-b",
    );

    pendingB.pending.resolve(response(200, { data: [] }));
    await requestB;
  } finally {
    harness.cleanup();
  }
});

test("stale restoration A failure cannot suppress replacement B", async () => {
  const harness = await createHarness();

  try {
    await install(harness, "token-a", 1);

    const userReadStarted = deferred();
    const userReadGate = deferred();

    harness.state.getStarted.set(
      "lfa_portal_user",
      userReadStarted,
    );
    harness.state.getGates.set(
      "lfa_portal_user",
      userReadGate,
    );

    const restorationA = harness.auth.authService.restoreSession();
    await userReadStarted.promise;

    await harness.auth.authService.saveSession({
      token: "token-b",
      user: { id: 2, email: "b@example.test" },
    });

    harness.state.failGetKeys.add("lfa_portal_user");
    userReadGate.resolve();

    const resultA = await restorationA;

    assert.equal(resultA.status, "stale");

    harness.state.failGetKeys.delete("lfa_portal_user");

    const requestB = harness.api.apiRequest("/portal/orders");
    const pendingB = await harness.waitForFetch();

    assert.equal(
      pendingB.init.headers.Authorization,
      "Bearer token-b",
    );

    pendingB.pending.resolve(response(200, { data: [] }));
    await requestB;
  } finally {
    harness.cleanup();
  }
});
