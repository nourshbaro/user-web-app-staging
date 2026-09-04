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

function response(status, body = {}, bytes = new ArrayBuffer(0)) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => bytes,
  };
}

async function createHarness({
  platform = "web",
  timeoutMs = 15000,
} = {}) {
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
    platform,
    timeoutMs,
    nextTimerId: 1,
    timers: new Map(),
    setTimer(callback, delay) {
      const id = this.nextTimerId++;
      this.timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      this.timers.delete(id);
    },
    fireTimers() {
      const pendingTimers = [...this.timers.entries()];
      this.timers.clear();

      for (const [, timer] of pendingTimers) {
        timer.callback();
      }
    },
    fetch(request, init) {
      const pending = deferred();
      this.fetches.push({ request, init, pending });

      const rejectForAbort = () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        pending.reject(error);
      };

      if (init.signal?.aborted) {
        rejectForAbort();
      } else {
        init.signal?.addEventListener("abort", rejectForAbort, {
          once: true,
        });
      }

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

  const authTokenStorageUrl = toModuleUrl(`
    import { storage } from ${JSON.stringify(storageUrl)};

    const TOKEN_KEY = "lfa_portal_token";

    export const authTokenStorage = {
      get() {
        return storage.get(TOKEN_KEY);
      },
      set(token) {
        return storage.set(TOKEN_KEY, token);
      },
      remove() {
        return storage.remove(TOKEN_KEY);
      },
    };
  `);

  const configUrl = toModuleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const config = {
      timeoutMs: state.timeoutMs,
      apiBaseUrl: "https://api.example.test",
      apiPassword: "public-password",
    };
  `);
  const reactNativeUrl = toModuleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const Platform = { OS: state.platform };
  `);
  const authorityUrl = toModuleUrl(transpile(authoritySource));
  const profilePortalUrl = toModuleUrl(
    "export const normalizePaginatedProfileResult = (payload) => payload;",
  );

  const executableApi = transpile(apiSource)
    .replace('from "@/lib/config"', `from ${JSON.stringify(configUrl)}`)
    .replace(
      'from "@/lib/authSessionOwnership"',
      `from ${JSON.stringify(authorityUrl)}`,
    )
    .replace(
      'from "@/lib/authTokenStorage"',
      `from ${JSON.stringify(authTokenStorageUrl)}`,
    )
    .replace('from "react-native"', `from ${JSON.stringify(reactNativeUrl)}`)
    .replaceAll(
      "await fetch(",
      `await globalThis[${JSON.stringify(key)}].fetch(`,
    );
  const apiUrl = toModuleUrl(executableApi);
  const api = await import(apiUrl);

  const executableAuth = transpile(authSource)
    .replace('from "react-native"', `from ${JSON.stringify(reactNativeUrl)}`)
    .replace('from "@/lib/config"', `from ${JSON.stringify(configUrl)}`)
    .replace('from "@/lib/profilePortal"', `from ${JSON.stringify(profilePortalUrl)}`)
    .replace('from "@/services/api"', `from ${JSON.stringify(apiUrl)}`)
    .replace('from "@/lib/storage"', `from ${JSON.stringify(storageUrl)}`)
    .replaceAll(
      "setTimeout(",
      `globalThis[${JSON.stringify(key)}].setTimer(`,
    )
    .replaceAll(
      "clearTimeout(",
      `globalThis[${JSON.stringify(key)}].clearTimer(`,
    )
    .replaceAll(
      "await fetch(",
      `await globalThis[${JSON.stringify(key)}].fetch(`,
    );
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

test("stalled PDF fetch aborts with a timeout transport error", async () => {
  const harness = await createHarness({ timeoutMs: 4321 });

  try {
    await install(harness, "token-a", 1);

    const request = harness.auth.profileService.orderPdf("order-1");
    const pending = await harness.waitForFetch();

    assert.equal(pending.init.signal.aborted, false);
    assert.equal(harness.state.timers.size, 1);
    assert.equal(
      [...harness.state.timers.values()][0].delay,
      4321,
    );

    harness.state.fireTimers();

    await assert.rejects(
      request,
      (error) => (
        error instanceof harness.api.ApiTransportError
        && error.category === "timeout"
        && error.message === "The request timed out. Please try again."
      ),
    );

    assert.equal(pending.init.signal.aborted, true);
    assert.equal(harness.state.timers.size, 0);
  } finally {
    harness.cleanup();
  }
});

test("stalled PDF body consumption remains covered by the timeout", async () => {
  const harness = await createHarness();
  const bodyStarted = deferred();

  try {
    await install(harness, "token-a", 1);

    const request = harness.auth.profileService.orderPdf("order-1");
    const pending = await harness.waitForFetch();

    pending.pending.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer() {
        bodyStarted.resolve();

        return new Promise((resolve, reject) => {
          pending.init.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("The operation was aborted.");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
    });

    await bodyStarted.promise;
    assert.equal(harness.state.timers.size, 1);

    harness.state.fireTimers();

    await assert.rejects(
      request,
      (error) => (
        error instanceof harness.api.ApiTransportError
        && error.category === "timeout"
      ),
    );

    assert.equal(pending.init.signal.aborted, true);
    assert.equal(harness.state.timers.size, 0);
  } finally {
    harness.cleanup();
  }
});

test("PDF success returns exact bytes and clears its timeout", async () => {
  const harness = await createHarness();
  const expectedBytes = new Uint8Array([37, 80, 68, 70]).buffer;

  try {
    await install(harness, "token-a", 1);

    const request = harness.auth.profileService.orderPdf("order 1");
    const pending = await harness.waitForFetch();

    assert.equal(
      pending.request,
      "/api/portal/orders/order%201/pdf",
    );
    assert.equal(
      pending.init.headers.Accept,
      "application/pdf,application/octet-stream,*/*",
    );
    assert.equal(
      pending.init.headers.Authorization,
      "Bearer token-a",
    );
    assert.equal(
      pending.init.headers.password,
      undefined,
    );

    pending.pending.resolve(
      response(200, {}, expectedBytes),
    );

    const actualBytes = await request;

    assert.deepEqual(actualBytes, new Uint8Array(expectedBytes));
    assert.equal(harness.state.timers.size, 0);
    assert.equal(pending.init.signal.aborted, false);

    harness.state.fireTimers();

    assert.equal(pending.init.signal.aborted, false);
  } finally {
    harness.cleanup();
  }
});

test("native PDF request preserves API URL and password header", async () => {
  const harness = await createHarness({ platform: "native" });
  const expectedBytes = new Uint8Array([1, 2, 3]).buffer;

  try {
    await install(harness, "token-a", 1);

    const request = harness.auth.profileService.orderPdf("order-1");
    const pending = await harness.waitForFetch();

    assert.equal(
      pending.request,
      "https://api.example.test/portal/orders/order-1/pdf",
    );
    assert.equal(
      pending.init.headers.password,
      "public-password",
    );
    assert.equal(
      pending.init.headers.Authorization,
      "Bearer token-a",
    );

    pending.pending.resolve(
      response(200, {}, expectedBytes),
    );

    assert.deepEqual(await request, new Uint8Array(expectedBytes));
    assert.equal(harness.state.timers.size, 0);
  } finally {
    harness.cleanup();
  }
});

test("PDF network rejection uses network transport classification", async () => {
  const harness = await createHarness();

  try {
    await install(harness, "token-a", 1);

    const request = harness.auth.profileService.orderPdf("order-1");
    const pending = await harness.waitForFetch();

    pending.pending.reject(new Error("offline"));

    await assert.rejects(
      request,
      (error) => (
        error instanceof harness.api.ApiTransportError
        && error.category === "network"
        && error.message === "Unable to reach the server. Check your connection and try again."
      ),
    );

    assert.equal(harness.state.timers.size, 0);
    assert.equal(pending.init.signal.aborted, false);

    harness.state.fireTimers();

    assert.equal(pending.init.signal.aborted, false);
  } finally {
    harness.cleanup();
  }
});

test("PDF HTTP 5xx preserves its message without auth invalidation", async () => {
  const harness = await createHarness();

  try {
    await install(harness, "token-a", 1);

    const request = harness.auth.profileService.orderPdf("order-1");
    const pending = await harness.waitForFetch();

    pending.pending.resolve(
      response(500, { message: "PDF unavailable" }),
    );

    await assert.rejects(request, /PDF unavailable/);

    assert.equal(
      harness.state.values.get("lfa_portal_token"),
      "token-a",
    );
    assert.equal(harness.state.notifications, 0);
    assert.equal(harness.state.timers.size, 0);

    harness.state.fireTimers();

    assert.equal(pending.init.signal.aborted, false);
  } finally {
    harness.cleanup();
  }
});

for (const status of [401, 403]) {
  test(`current PDF ${status} invalidates current authentication`, async () => {
    const harness = await createHarness();

    try {
      await install(harness, "token-a", 1);

      const request = harness.auth.profileService.orderPdf("order-1");
      const pending = await harness.waitForFetch();

      pending.pending.resolve(
        response(status, { message: "PDF authentication rejected" }),
      );

      await assert.rejects(
        request,
        /PDF authentication rejected/,
      );

      assert.equal(
        harness.state.values.has("lfa_portal_token"),
        false,
      );
      assert.equal(harness.state.notifications, 1);
      assert.equal(harness.state.timers.size, 0);
    } finally {
      harness.cleanup();
    }
  });
}

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
