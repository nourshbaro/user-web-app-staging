import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { toBackendPhoneDigits, updateNationalPhone } from "../lib/phoneNumber.ts";

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

/**
 * Loads the real `authService` with `apiRequest` replaced by a recorder that
 * answers `respond(path, body)`. `persistedUser` is what storage returns.
 */
async function loadAuthService({ respond = () => ({}), persistedUser = null } = {}) {
  globalThis.__authTest = { calls: [], tokens: [], respond, persistedUser };
  const apiSource = `
    export class ApiError extends Error {
      constructor(message, status, body) { super(message); this.status = status; this.body = body; }
    }
    export async function apiRequest(path, init = {}) {
      const body = init.body ? JSON.parse(init.body) : undefined;
      globalThis.__authTest.calls.push({ path, body, init });
      return globalThis.__authTest.respond(path, body);
    }
    export const ApiTransportError = Error;
    export const activateMaintenance = () => {};
    export const beginAuthenticationLogout = async () => ({ token: null });
    export const captureAuthenticationSnapshot = async () => ({ generation: 0, token: null });
    export const clearAuthentication = async () => {};
    export const invalidateAuthentication = async () => {};
    export const restoreAuthentication = async () => ({ status: "unauthenticated", authentication: { generation: 0, token: null } });
    export const setToken = async (token) => { globalThis.__authTest.tokens.push(token); };
    export const unwrapData = (value) => value?.data ?? value;
  `;
  const stubs = {
    "react-native": 'export const Platform = { OS: "web" };',
    "expo-file-system": "export class File {}",
    "@/lib/config": "export const config = { timeoutMs: 15000, apiBaseUrl: '' };",
    "@/lib/storage": "export const storage = { get: async () => globalThis.__authTest.persistedUser, set: async () => {}, remove: async () => {} };",
    "@/lib/profilePortal": "export const normalizePaginatedProfileResult = (payload) => payload;",
    "@/lib/userFacingError": "export const backendResponseMessage = () => null;",
    "@/services/api": apiSource,
  };
  const source = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
  let executable = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [specifier, stub] of Object.entries(stubs)) {
    executable = executable.replace(`from "${specifier}"`, `from ${JSON.stringify(moduleUrl(stub))}`);
  }
  const { authService } = await import(moduleUrl(executable));
  return { authService, calls: globalThis.__authTest.calls, tokens: globalThis.__authTest.tokens };
}

const SESSION = { token: "session-token", user: { id: 6, name: "Fan", email: null, phone: "96171123456" } };

test("login with email sends { email, password, remember } and no phone", async () => {
  const { authService, calls, tokens } = await loadAuthService({ respond: () => SESSION });
  const result = await authService.login({ email: "fan@example.com" }, "secret", true);
  assert.equal(result.status, "authenticated");
  assert.deepEqual(calls[0].path, "/auth/login");
  assert.deepEqual(calls[0].body, { email: "fan@example.com", password: "secret", remember: true });
  assert.deepEqual(tokens, ["session-token"]);
});

test("login with a phone sends the normalized digits as { phone } and no email", async () => {
  const phone = updateNationalPhone("71 123 456", "LB");
  assert.equal(phone.validation, "valid");
  const digits = toBackendPhoneDigits(phone.canonicalPhone);
  assert.equal(digits, "96171123456");

  const { authService, calls } = await loadAuthService({ respond: () => SESSION });
  await authService.login({ phone: digits }, "secret", false);
  assert.deepEqual(calls[0].body, { phone: "96171123456", password: "secret", remember: false });
  assert.equal("email" in calls[0].body, false);
  assert.equal(calls[0].init.skipUnauthenticatedNotify, true);
});

test("an invalid phone never yields an identifier", () => {
  const invalid = updateNationalPhone("71 12", "LB");
  assert.equal(invalid.validation, "invalid");
  assert.equal(toBackendPhoneDigits(invalid.canonicalPhone), "");
  // An excluded country is never accepted either.
  assert.equal(updateNationalPhone("+972501234567", "LB").validation, "excluded-country");
});

test("registration with an email sends it", async () => {
  const { authService, calls } = await loadAuthService({ respond: () => SESSION });
  await authService.register("Fan", "fan@example.com", "Abcdef12!", "Abcdef12!", "96171123456");
  assert.deepEqual(calls[0].body, {
    name: "Fan",
    email: "fan@example.com",
    password: "Abcdef12!",
    password_confirmation: "Abcdef12!",
    phone: "96171123456",
  });
});

test("registration without an email omits the field (backend: name, phone, password required)", async () => {
  const { authService, calls, tokens } = await loadAuthService({ respond: () => SESSION });
  await authService.register("Fan", null, "Abcdef12!", "Abcdef12!", "96171123456");
  assert.deepEqual(calls[0].body, {
    name: "Fan",
    password: "Abcdef12!",
    password_confirmation: "Abcdef12!",
    phone: "96171123456",
  });
  assert.equal("email" in calls[0].body, false);
  assert.deepEqual(tokens, ["session-token"]);
});

test("forgot-password sends exactly one identifier field", async () => {
  const { authService, calls } = await loadAuthService({ respond: () => ({ message: "If that account is registered, a reset code has been sent." }) });
  await authService.forgotPassword({ email: "fan@example.com" });
  await authService.forgotPassword({ phone: "96171123456" });
  assert.deepEqual(calls.map(({ path, body }) => [path, body]), [
    ["/auth/forgot-password", { email: "fan@example.com" }],
    ["/auth/forgot-password", { phone: "96171123456" }],
  ]);
  assert.ok(calls.every(({ init }) => init.skipUnauthenticatedNotify === true));
});

test("forgot-password returns the backend answer unchanged for the recovery owner to read", async () => {
  const answer = { message: "Please add an email to your account to reset your password.", reason: "email_required" };
  const { authService } = await loadAuthService({ respond: () => answer });
  assert.deepEqual(await authService.forgotPassword({ phone: "96171123456" }), answer);
});

test("add-email posts the exact { email, phone } payload and saves no session", async () => {
  const { authService, calls, tokens } = await loadAuthService({ respond: () => ({ message: "If that account is registered, a reset code has been sent." }) });
  await authService.addRecoveryEmail("96171123456", "test2@example.com");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/auth/forgot-password/add-email");
  assert.deepEqual(calls[0].body, { email: "test2@example.com", phone: "96171123456" });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.skipUnauthenticatedNotify, true);
  assert.deepEqual(tokens, []);
});

test("add-email failure propagates (the screen keeps the step and the values)", async () => {
  const { authService } = await loadAuthService({
    respond: () => { throw Object.assign(new Error("Account not found."), { status: 422 }); },
  });
  await assert.rejects(authService.addRecoveryEmail("96171123456", "test2@example.com"), /Account not found/);
});

test("recovery OTP and reset stay keyed by email (backend authority)", async () => {
  const { authService, calls } = await loadAuthService({ respond: () => ({}) });
  await authService.verifyForgotPasswordOtp("fan@example.com", "123456");
  await authService.resetPassword("fan@example.com", "123456", "Newpass1!", "Newpass1!");
  assert.deepEqual(calls.map(({ path, body }) => [path, body]), [
    ["/auth/forgot-password/verify-otp", { email: "fan@example.com", code: "123456" }],
    ["/auth/reset-password", { email: "fan@example.com", code: "123456", password: "Newpass1!", password_confirmation: "Newpass1!" }],
  ]);
});

test("a phone-only account (email: null) is a valid /auth/me user and a valid persisted user", async () => {
  const user = {
    id: 6, name: "Fan", email: null, phone: "96171123456", avatar: null, email_verified_at: null,
    created_at: "2026-10-06T12:32:36.000000Z", updated_at: "2026-10-06T12:32:36.000000Z", deleted_at: null,
  };
  const { authService } = await loadAuthService({ respond: () => ({ data: user }), persistedUser: JSON.stringify(user) });
  assert.deepEqual(await authService.me(), user);
  assert.deepEqual(await authService.currentUser(), user);
});

test("a non-string, non-null email is still rejected", async () => {
  const { authService } = await loadAuthService({ persistedUser: JSON.stringify({ id: 6, email: 42 }) });
  await assert.rejects(authService.currentUser(), /invalid/);
});
