import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const apiSource = await readFile(new URL("./api.ts", import.meta.url), "utf8");
const authSource = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
const authoritySource = await readFile(new URL("../lib/authSessionOwnership.ts", import.meta.url), "utf8");
const userFacingErrorSource = await readFile(new URL("../lib/userFacingError.ts", import.meta.url), "utf8");

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
    transpile(await readFile(new URL("../lib/profilePortal.ts", import.meta.url), "utf8")),
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
    .replace('from "expo-file-system"', `from "data:text/javascript,export class File {}"`)
    .replace('from "react-native"', `from ${JSON.stringify(reactNativeUrl)}`)
    .replaceAll(
      "await fetch(",
      `await globalThis[${JSON.stringify(key)}].fetch(`,
    );
  const apiUrl = toModuleUrl(executableApi);
  const api = await import(apiUrl);
  const userFacingErrorUrl = toModuleUrl(
    transpile(userFacingErrorSource).replace(
      'from "@/services/api"',
      `from ${JSON.stringify(apiUrl)}`,
    ),
  );

  const executableAuth = transpile(authSource)
    .replace('from "expo-file-system"', `from "data:text/javascript,export class File {}"`)
    .replace('from "react-native"', `from ${JSON.stringify(reactNativeUrl)}`)
    .replace('from "@/lib/config"', `from ${JSON.stringify(configUrl)}`)
    .replace('from "@/lib/profilePortal"', `from ${JSON.stringify(profilePortalUrl)}`)
    .replace('from "@/lib/userFacingError"', `from ${JSON.stringify(userFacingErrorUrl)}`)
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


test("change password accepts message-only success without replacing the old token", async () => {
  const h = await createHarness();
  try {
    await install(h, "old-token", 1);
    const change = h.auth.authService.changePassword(" current password ", " new password ", " new password ");
    const pending = await h.waitForFetch();
    assert.equal(pending.request, "/api/auth/change-password");
    assert.equal(pending.init.method, "POST");
    assert.deepEqual(JSON.parse(pending.init.body), {
      current_password: " current password ",
      password: " new password ",
      password_confirmation: " new password ",
    });
    assert.equal(pending.init.headers.Authorization, "Bearer old-token");
    pending.pending.resolve(response(200, { message: "Password changed. Please log in again." }));
    assert.equal(await change, "Password changed. Please log in again.");
    assert.equal((await h.api.captureAuthenticationSnapshot()).token, "old-token");
    assert.deepEqual(JSON.parse(h.state.values.get("lfa_portal_user")), { id: 1 });
  } finally { h.cleanup(); }
});

test("failed password change preserves authentication for recovery", async () => {
  const h = await createHarness();
  try {
    await install(h, "old-token", 1);
    const change = h.auth.authService.changePassword("wrong", "new password", "new password");
    const pending = await h.waitForFetch();
    pending.pending.resolve(response(422, { message: "private validation text" }));
    await assert.rejects(change, (error) => error.status === 422);
    assert.equal((await h.api.captureAuthenticationSnapshot()).token, "old-token");
  } finally { h.cleanup(); }
});

test("failed token removal stays fail-closed and still clears persisted user", async () => {
  const h = await createHarness();
  try {
    await install(h, "old-token", 1);
    h.state.failRemoveKeys.add("lfa_portal_token");
    await assert.rejects(h.auth.authService.clearSession());
    assert.equal((await h.api.captureAuthenticationSnapshot()).token, null);
    assert.equal(h.state.values.has("lfa_portal_user"), false);
    h.state.failRemoveKeys.clear();
    await h.api.setToken("new-token");
    assert.equal((await h.api.captureAuthenticationSnapshot()).token, "new-token");
  } finally { h.cleanup(); }
});

for (const filter of ["all", "upcoming", "past"]) {
  test("portal matches uses the requested filter: " + filter, async () => {
    const h = await createHarness();
    try {
      const request = h.auth.profileService.matches(filter);
      const pending = await h.waitForFetch();
      assert.equal(pending.request, "/api/portal/matches?filter=" + filter);
      const portalMatch = {
        match_id: 23,
        kickoff_at: "2026-09-03T21:45:00+03:00",
        is_upcoming: false,
        status: "scheduled",
        home_team: { id: 9, name: "Al Riyadi Al Abasiya", logo: "teams/home.png" },
        away_team: { id: 5, name: "Al Safa", logo: null },
        stadium: "Camille Chamoun Sports City Stadium",
        ticket_count: 1,
      };
      pending.pending.resolve(response(200, { data: [portalMatch] }));
      assert.deepEqual((await request).items, [portalMatch]);
    } finally { h.cleanup(); }
  });
}

test("match tickets preserves paginated normalization and sends the selected numeric match ID", async () => {
  const h = await createHarness();
  try {
    const request = h.auth.profileService.tickets(23);
    const pending = await h.waitForFetch();
    assert.equal(pending.request, "/api/portal/tickets?match_id=23");
    const ticket = {
      ticket_code: "5108299550",
      holder_name: "Match 2",
      status: "valid",
      order_code: "ORD-1172",
      match: {
        id: 23,
        kickoff_at: "21:45:00",
        home_team: "Al Riyadi Al Abasiya",
        home_team_logo: "teams/home.png",
        away_team: "Al Safa",
        away_team_logo: null,
      },
      zone: { id: 18, name: "Zone A" },
      seat: null,
      checked_in_at: null,
      created_at: "2026-09-03 13:20:00",
      qr_image: "data:image/png;base64,abc",
    };
    pending.pending.resolve(response(200, {
      data: [ticket],
      meta: { page: 1, per_page: 20, total: 1, last_page: 1 },
    }));
    assert.deepEqual(await request, { items: [ticket], total: 1 });
  } finally { h.cleanup(); }
});

const listedTicket = (overrides = {}) => ({
  ticket_code: "5108299550",
  holder_name: "Match 2",
  status: "valid",
  order_code: "ORD-1172",
  match: { id: 23, kickoff_at: "21:45:00", home_team: "Al Riyadi", home_team_logo: null, away_team: "Al Safa", away_team_logo: null },
  zone: { id: 18, name: "Zone A" },
  seat: null,
  checked_in_at: null,
  created_at: "2026-09-03 13:20:00",
  qr_image: "data:image/png;base64,abc",
  ...overrides,
});

async function listTickets(items) {
  const h = await createHarness();
  try {
    const request = h.auth.profileService.tickets(23);
    const pending = await h.waitForFetch();
    pending.pending.resolve(response(200, { data: items, meta: { page: 1, per_page: 20, total: items.length, last_page: 1 } }));
    return await request;
  } finally { h.cleanup(); }
}

test("a listed ticket stays valid when its QR is present, empty, null or absent (the detail endpoint completes it)", async () => {
  const { qr_image: _omitted, ...withoutQr } = listedTicket();
  const items = [listedTicket(), listedTicket({ ticket_code: "2", qr_image: "" }), listedTicket({ ticket_code: "3", qr_image: null }), { ...withoutQr, ticket_code: "4" }];
  const result = await listTickets(items);
  assert.equal(result.items.length, 4);
  assert.deepEqual(result.items.map((ticket) => ticket.qr_image), ["data:image/png;base64,abc", "", null, undefined]);
});

test("only the QR field was relaxed: a non-string QR or a broken ticket field still rejects the list", async () => {
  await assert.rejects(() => listTickets([listedTicket({ qr_image: 42 })]), /Invalid portal ticket response/);
  await assert.rejects(() => listTickets([listedTicket({ qr_image: { url: "x" } })]), /Invalid portal ticket response/);
  await assert.rejects(() => listTickets([listedTicket({ holder_name: null })]), /Invalid portal ticket response/);
  await assert.rejects(() => listTickets([listedTicket({ status: undefined })]), /Invalid portal ticket response/);
});

/* Avatar results publish only into the session that started them. */

async function avatarRace({ path, method, switchAccount }) {
  const { runOwnedAvatarMutation } = await import("../lib/avatarMutationOwnership.ts");
  const h = await createHarness();
  try {
    await install(h, "token-a", "A");
    const published = [];
    const outcome = runOwnedAvatarMutation({
      capture: () => h.api.captureAuthenticationSnapshot(),
      isCurrent: (snapshot) => h.api.isAuthenticationSnapshotCurrent(snapshot),
      request: () => h.api.apiRequest(path, { method }),
      // The Profile screen's user at publication time (A's stale render).
      nextUser: (result) => ({ id: "A", avatar: result?.avatar ?? null }),
      publish: async (user) => {
        published.push(user);
        await h.auth.authService.persistUser(user);
      },
    });
    const pending = await h.waitForFetch();
    if (switchAccount) await switchAccount(h);
    pending.pending.resolve(response(200, { avatar: "avatars/a.jpg" }));
    return { outcome: await outcome, published, stored: JSON.parse(h.state.values.get("lfa_portal_user") ?? "null"), token: (await h.api.captureAuthenticationSnapshot()).token };
  } finally { h.cleanup(); }
}

const logoutThenLoginB = async (h) => {
  await h.api.clearToken();
  await install(h, "token-b", "B");
};

test("A's avatar upload resolving after A logs out and B logs in never publishes into B's session", async () => {
  const race = await avatarRace({ path: "/auth/profile-picture", method: "POST", switchAccount: logoutThenLoginB });
  assert.equal(race.outcome, "stale");
  assert.deepEqual(race.published, [], "updateUser is never called with A's user");
  assert.deepEqual(race.stored, { id: "B" }, "B's persisted user is untouched");
  assert.equal(race.token, "token-b", "B remains signed in");
});

test("A's avatar removal resolving after the account changes never publishes into B's session", async () => {
  const race = await avatarRace({ path: "/auth/profile-picture", method: "DELETE", switchAccount: logoutThenLoginB });
  assert.equal(race.outcome, "stale");
  assert.deepEqual(race.published, []);
  assert.deepEqual(race.stored, { id: "B" });
});

test("an avatar result after logout alone (no next account) is also dropped", async () => {
  const race = await avatarRace({ path: "/auth/profile-picture", method: "DELETE", switchAccount: (h) => h.api.clearToken() });
  assert.equal(race.outcome, "stale");
  assert.deepEqual(race.published, []);
  assert.equal(race.token, null);
});

test("an avatar result in the same session publishes as before", async () => {
  const race = await avatarRace({ path: "/auth/profile-picture", method: "POST" });
  assert.equal(race.outcome, "published");
  assert.deepEqual(race.published, [{ id: "A", avatar: "avatars/a.jpg" }]);
  assert.deepEqual(race.stored, { id: "A", avatar: "avatars/a.jpg" });
});

test("an ordinary HTTP 503 activates sticky global maintenance without clearing authentication", async () => {
  const h = await createHarness();
  try {
    await install(h, "token-a", 1);
    let notifications = 0;
    const unsubscribe = h.api.subscribeMaintenance(() => {
      notifications += 1;
    });

    const request = h.api.apiRequest("/portal/matches?filter=all");
    const pending = await h.waitForFetch();
    pending.pending.resolve(response(503, { message: "Service unavailable" }));

    await assert.rejects(request, (error) => error.status === 503);
    assert.equal(h.api.getMaintenanceSnapshot(), true);
    assert.equal(notifications, 1);
    assert.equal((await h.api.captureAuthenticationSnapshot()).token, "token-a");
    assert.deepEqual(JSON.parse(h.state.values.get("lfa_portal_user")), { id: 1 });
    unsubscribe();
  } finally {
    h.cleanup();
  }
});

test("network failures do not activate maintenance", async () => {
  const h = await createHarness();
  try {
    const request = h.api.apiRequest("/portal/matches?filter=all");
    const pending = await h.waitForFetch();
    pending.pending.reject(new Error("offline"));

    await assert.rejects(
      request,
      (error) => error.category === "network",
    );
    assert.equal(h.api.getMaintenanceSnapshot(), false);
  } finally {
    h.cleanup();
  }
});

test("the PDF transport also activates maintenance only for an HTTP 503", async () => {
  const h = await createHarness();
  try {
    await install(h, "token-a", 1);
    const request = h.auth.profileService.orderPdf("ORD-1172");
    const pending = await h.waitForFetch();
    pending.pending.resolve(response(503, { message: "Maintenance in progress" }));

    await assert.rejects(request, { message: "Maintenance in progress" });
    assert.equal(h.api.getMaintenanceSnapshot(), true);
    assert.equal((await h.api.captureAuthenticationSnapshot()).token, "token-a");
  } finally {
    h.cleanup();
  }
});
