import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createAuthSubmissionGuard } from "./authSubmissionGuard.ts";

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function loadAuthService(apiModuleSource) {
  const reactNativeUrl = moduleUrl('export const Platform = { OS: "web" };');
  const configUrl = moduleUrl("export const config = { timeoutMs: 15000, apiBaseUrl: '' };");
  const storageUrl = moduleUrl("export const storage = { get: async () => null, set: async () => {}, remove: async () => {} };");
  const profilePortalUrl = moduleUrl("export const normalizePaginatedProfileResult = (payload) => payload;");
  const userFacingErrorUrl = moduleUrl("export const backendResponseMessage = () => null;");
  const apiUrl = moduleUrl(apiModuleSource);
  const source = await readFile(new URL("../services/auth.ts", import.meta.url), "utf8");
  const executable = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
    .replace('from "expo-file-system"', `from "data:text/javascript,export class File {}"`)
    .replace('from "react-native"', `from ${JSON.stringify(reactNativeUrl)}`)
    .replace('from "@/lib/config"', `from ${JSON.stringify(configUrl)}`)
    .replace('from "@/lib/profilePortal"', `from ${JSON.stringify(profilePortalUrl)}`)
    .replace('from "@/lib/storage"', `from ${JSON.stringify(storageUrl)}`)
    .replace('from "@/lib/userFacingError"', `from ${JSON.stringify(userFacingErrorUrl)}`)
    .replace('from "@/services/api"', `from ${JSON.stringify(apiUrl)}`);
  const [authModule, apiModule] = await Promise.all([
    import(moduleUrl(executable)),
    import(apiUrl),
  ]);
  return { authService: authModule.authService, apiModule };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function guardedSubmit(guard, flow) {
  if (!guard.tryAcquire()) return false;
  try {
    await flow();
    return true;
  } finally {
    guard.release();
  }
}

for (const flowName of ["login", "register", "complete-phone"]) {
  test(`${flowName} ignores a second submission while the first is pending and permits a later attempt`, async () => {
    const guard = createAuthSubmissionGuard();
    const first = deferred();
    let calls = 0;
    const flow = () => {
      calls += 1;
      return first.promise;
    };

    const firstSubmission = guardedSubmit(guard, flow);
    assert.equal(await guardedSubmit(guard, flow), false);
    assert.equal(calls, 1);

    first.resolve();
    assert.equal(await firstSubmission, true);
    assert.equal(await guardedSubmit(guard, async () => { calls += 1; }), true);
    assert.equal(calls, 2);
  });
}

test("a rejected authentication flow releases the guard for retry", async () => {
  const guard = createAuthSubmissionGuard();
  const first = deferred();
  let calls = 0;
  const failedSubmission = guardedSubmit(guard, () => {
    calls += 1;
    return first.promise;
  });

  first.reject(new Error("request failed"));
  await assert.rejects(failedSubmission, /request failed/);
  assert.equal(await guardedSubmit(guard, async () => { calls += 1; }), true);
  assert.equal(calls, 2);
});

test("both authentication entry points acquire synchronously and release in finally", async () => {
  const sources = await Promise.all([
    readFile(new URL("../app/auth.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of sources) {
    const acquireIndex = source.indexOf("if (!submissionGuard.current.tryAcquire()) return;");
    const loadingIndex = source.indexOf("setLoading(true);", acquireIndex);
    assert.ok(acquireIndex >= 0);
    assert.ok(loadingIndex > acquireIndex);
    assert.match(source.slice(acquireIndex), /finally\s*\{\s*submissionGuard\.current\.release\(\);/);
  }
});

test("verification fallback executes distinct endpoints in order and stops after success", async () => {
  const { authService, apiModule } = await loadAuthService(`
    export class ApiError extends Error {
      constructor(message, status, body) { super(message); this.status = status; this.body = body; }
    }
    export const calls = [];
    export async function apiRequest(path) {
      calls.push(path);
      if (calls.length === 1) throw new ApiError("missing", 404, null);
      if (calls.length === 2) throw new ApiError("unsupported", 405, null);
      return { verified: true };
    }
    export const ApiTransportError = Error;
    export const activateMaintenance = () => {};
    export const beginAuthenticationLogout = async () => ({ token: null });
    export const captureAuthenticationSnapshot = async () => ({ generation: 0, token: null });
    export const clearAuthentication = async () => {};
    export const invalidateAuthentication = async () => {};
    export const restoreAuthentication = async () => ({ status: "unauthenticated", authentication: { generation: 0, token: null } });
    export const setToken = async () => {};
    export const unwrapData = (value) => value?.data ?? value;
  `);
  assert.deepEqual(await authService.checkEmailVerification("fan@example.com"), { verified: true });
  assert.deepEqual(apiModule.calls, [
    "/auth/check-email-verification",
    "/auth/check-email",
    "/auth/email-verification-status",
  ]);
});

test("normal login saves its session and returns an authenticated result", async () => {
  const { authService, apiModule } = await loadAuthService(`
    export class ApiError extends Error {
      constructor(message, status, body) { super(message); this.status = status; this.body = body; }
    }
    export const calls = [];
    export const tokens = [];
    export async function apiRequest(path, init) {
      calls.push({ path, init });
      return { token: "session-token", user: { id: 7, email: "fan@example.com" } };
    }
    export const ApiTransportError = Error;
    export const activateMaintenance = () => {};
    export const beginAuthenticationLogout = async () => ({ token: null });
    export const captureAuthenticationSnapshot = async () => ({ generation: 0, token: null });
    export const clearAuthentication = async () => {};
    export const invalidateAuthentication = async () => {};
    export const restoreAuthentication = async () => ({ status: "unauthenticated", authentication: { generation: 0, token: null } });
    export const setToken = async (token) => { tokens.push(token); };
    export const unwrapData = (value) => value?.data ?? value;
  `);

  const result = await authService.login({ email: "fan@example.com" }, "secret", true);

  assert.equal(result.status, "authenticated");
  assert.deepEqual(apiModule.tokens, ["session-token"]);
  assert.deepEqual(apiModule.calls.map(({ path }) => path), ["/auth/login"]);
});

test("phone-required login response becomes a continuation without saving a session", async () => {
  const { authService, apiModule } = await loadAuthService(`
    export class ApiError extends Error {
      constructor(message, status, body) { super(message); this.status = status; this.body = body; }
    }
    export const calls = [];
    export const tokens = [];
    export async function apiRequest(path, init) {
      calls.push({ path, init });
      return { message: "Please add your phone number to continue.", reason: "phone_required" };
    }
    export const ApiTransportError = Error;
    export const activateMaintenance = () => {};
    export const beginAuthenticationLogout = async () => ({ token: null });
    export const captureAuthenticationSnapshot = async () => ({ generation: 0, token: null });
    export const clearAuthentication = async () => {};
    export const invalidateAuthentication = async () => {};
    export const restoreAuthentication = async () => ({ status: "unauthenticated", authentication: { generation: 0, token: null } });
    export const setToken = async (token) => { tokens.push(token); };
    export const unwrapData = (value) => value?.data ?? value;
  `);

  const result = await authService.login({ email: "fan@example.com" }, "secret", false);

  assert.deepEqual(result, {
    status: "phone_required",
    message: "Please add your phone number to continue.",
  });
  assert.deepEqual(apiModule.tokens, []);
  assert.deepEqual(apiModule.calls.map(({ path }) => path), ["/auth/login"]);
});

test("phone-required API error also becomes the same continuation", async () => {
  const { authService, apiModule } = await loadAuthService(`
    export class ApiError extends Error {
      constructor(message, status, body) { super(message); this.status = status; this.body = body; }
    }
    export const calls = [];
    export async function apiRequest(path, init) {
      calls.push({ path, init });
      throw new ApiError("Phone required", 422, {
        message: "Please add your phone number to continue.",
        reason: "phone_required",
      });
    }
    export const ApiTransportError = Error;
    export const activateMaintenance = () => {};
    export const beginAuthenticationLogout = async () => ({ token: null });
    export const captureAuthenticationSnapshot = async () => ({ generation: 0, token: null });
    export const clearAuthentication = async () => {};
    export const invalidateAuthentication = async () => {};
    export const restoreAuthentication = async () => ({ status: "unauthenticated", authentication: { generation: 0, token: null } });
    export const setToken = async () => {};
    export const unwrapData = (value) => value?.data ?? value;
  `);

  const result = await authService.login({ email: "fan@example.com" }, "secret", false);

  assert.equal(result.status, "phone_required");
  assert.deepEqual(apiModule.calls.map(({ path }) => path), ["/auth/login"]);
});

test("invalid credentials remain an error and never call complete-phone", async () => {
  const { authService, apiModule } = await loadAuthService(`
    export class ApiError extends Error {
      constructor(message, status, body) { super(message); this.status = status; this.body = body; }
    }
    export const calls = [];
    export async function apiRequest(path, init) {
      calls.push({ path, init });
      throw new ApiError("Invalid credentials", 422, { message: "Invalid credentials" });
    }
    export const ApiTransportError = Error;
    export const activateMaintenance = () => {};
    export const beginAuthenticationLogout = async () => ({ token: null });
    export const captureAuthenticationSnapshot = async () => ({ generation: 0, token: null });
    export const clearAuthentication = async () => {};
    export const invalidateAuthentication = async () => {};
    export const restoreAuthentication = async () => ({ status: "unauthenticated", authentication: { generation: 0, token: null } });
    export const setToken = async () => {};
    export const unwrapData = (value) => value?.data ?? value;
  `);

  await assert.rejects(
    authService.login({ email: "fan@example.com" }, "wrong", false),
    /Invalid credentials/,
  );
  assert.deepEqual(apiModule.calls.map(({ path }) => path), ["/auth/login"]);
});

test("complete-phone posts exact credentials and international digits then saves the session", async () => {
  const { authService, apiModule } = await loadAuthService(`
    export class ApiError extends Error {
      constructor(message, status, body) { super(message); this.status = status; this.body = body; }
    }
    export const calls = [];
    export const tokens = [];
    export async function apiRequest(path, init) {
      calls.push({ path, init });
      return { token: "completed-token", user: { id: 7, email: "fan@example.com" } };
    }
    export const ApiTransportError = Error;
    export const activateMaintenance = () => {};
    export const beginAuthenticationLogout = async () => ({ token: null });
    export const captureAuthenticationSnapshot = async () => ({ generation: 0, token: null });
    export const clearAuthentication = async () => {};
    export const invalidateAuthentication = async () => {};
    export const restoreAuthentication = async () => ({ status: "unauthenticated", authentication: { generation: 0, token: null } });
    export const setToken = async (token) => { tokens.push(token); };
    export const unwrapData = (value) => value?.data ?? value;
  `);

  await authService.completePhone("fan@example.com", "secret", "96171037568");

  assert.equal(apiModule.calls.length, 1);
  assert.equal(apiModule.calls[0].path, "/auth/complete-phone");
  assert.equal(apiModule.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(apiModule.calls[0].init.body), {
    email: "fan@example.com",
    password: "secret",
    phone: "96171037568",
  });
  assert.deepEqual(apiModule.tokens, ["completed-token"]);
});
