import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceSource = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
const screenSource = await readFile(new URL("../app/auth.tsx", import.meta.url), "utf8");

test("login sends the backend-owned remember boolean without changing session handling", () => {
  assert.match(
    serviceSource,
    /async login\(\s*email: string,\s*password: string,\s*remember: boolean,?\s*\)/,
  );
  assert.match(serviceSource, /JSON\.stringify\(\{ email, password, remember \}\)/);
  assert.match(serviceSource, /await this\.saveSession\(payload\)/);
  assert.match(
    screenSource,
    /authService\.login\(\s*trimmedEmail,\s*password,\s*remember,?\s*\)/,
  );
  assert.match(screenSource, /useState\(false\)/);
  assert.match(screenSource, /accessibilityRole="checkbox"/);
});

test("forgot-password service methods use the exact paths and payload field names", () => {
  const resetMethod = serviceSource.slice(
    serviceSource.indexOf("  async resetPassword("),
    serviceSource.indexOf("  async checkEmailVerification("),
  );
  assert.match(serviceSource, /apiRequest\("\/auth\/forgot-password"/);
  assert.match(serviceSource, /JSON\.stringify\(\{ email \}\)/);
  assert.match(serviceSource, /apiRequest\("\/auth\/forgot-password\/verify-otp"/);
  assert.match(serviceSource, /JSON\.stringify\(\{ email, code \}\)/);
  assert.match(serviceSource, /apiRequest\("\/auth\/reset-password"/);
  assert.match(resetMethod, /"password_confirmation": passwordConfirmation/);
  assert.doesNotMatch(resetMethod, /password-confirmation/);
});

test("recovery OTP remains a six-character string and registration reuses shared phone UI", () => {
  assert.match(screenSource, /setRecoveryCode\(value\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\)\)/);
  assert.match(
    screenSource,
    /verifyForgotPasswordOtp\(\s*recoveryEmail,\s*recoveryCode,?\s*\)/,
  );
  assert.match(
    screenSource,
    /resetPassword\(\s*recoveryEmail,\s*recoveryCode,\s*recoveryPassword,\s*recoveryPasswordConfirmation,?\s*\)/,
  );
  assert.match(screenSource, /<InternationalPhoneInput/);
  assert.match(screenSource, /value=\{registrationPhone\}/);
});

test("phone-required is an explicit login continuation with the exact completion contract", () => {
  assert.match(serviceSource, /data\.reason !== "phone_required"/);
  assert.match(serviceSource, /status: "phone_required"/);
  assert.match(serviceSource, /apiRequest\("\/auth\/complete-phone"/);
  assert.match(serviceSource, /JSON\.stringify\(\{ email, password, phone \}\)/);
  assert.match(screenSource, /result\.status === "phone_required"/);
  assert.match(screenSource, /setMode\("complete-phone"\)/);
  assert.match(screenSource, /authService\.completePhone\(/);
  assert.match(
    screenSource,
    /toBackendPhoneDigits\(completionPhone\.canonicalPhone\)/,
  );
});

test("phone completion keeps credentials in screen memory and clears them on success or cancel", () => {
  assert.match(screenSource, /const cancelPhoneCompletion = \(\) => \{\s*setPassword\(""\)/);
  assert.match(screenSource, /setCompletionPhone\(createEmptyPhoneValue\(\)\)/);
  assert.match(screenSource, /if \(mode === "complete-phone"\) return cancelPhoneCompletion\(\)/);
  assert.doesNotMatch(screenSource, /params[^\n]*password|password[^\n]*params/);
  assert.doesNotMatch(screenSource, /storage\.(set|remove)|SecureStore|AsyncStorage/);
  assert.doesNotMatch(screenSource, /console\.(log|error)[^\n]*password/);
});

test("registration payload sends the digits-only phone contract now that it is authoritative", () => {
  const registerMethod = serviceSource.slice(
    serviceSource.indexOf("  async register("),
    serviceSource.indexOf("  async me("),
  );
  assert.ok(registerMethod.length > 0);
  assert.match(registerMethod, /phone: string/);
  assert.match(registerMethod, /phone,/);
  assert.match(
    screenSource,
    /toBackendPhoneDigits\(registrationPhone\.canonicalPhone\)/,
  );
});
