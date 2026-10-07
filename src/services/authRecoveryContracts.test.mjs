import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceSource = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
const screenSource = await readFile(new URL("../app/auth.tsx", import.meta.url), "utf8");

test("login sends the email-or-phone identifier and the backend-owned remember boolean", () => {
  assert.match(
    serviceSource,
    /async login\(\s*identifier: LoginIdentifier,\s*password: string,\s*remember: boolean,?\s*\)/,
  );
  assert.match(serviceSource, /export type LoginIdentifier = \{ email: string \} \| \{ phone: string \};/);
  assert.match(serviceSource, /JSON\.stringify\(\{ \.\.\.identifierBody\(identifier\), password, remember \}\)/);
  assert.match(serviceSource, /await this\.saveSession\(payload\)/);
  assert.match(
    screenSource,
    /authService\.login\(identifier, password, remember\)/,
  );
  // The phone identifier is the shared international-phone digits, never a second parser.
  assert.match(screenSource, /identifier = \{ phone: toBackendPhoneDigits\(loginPhone\.canonicalPhone\) \}/);
  assert.match(screenSource, /identifier = \{ email: trimmedEmail \}/);
  assert.match(screenSource, /useState\(false\)/);
  assert.match(screenSource, /accessibilityRole="checkbox"/);
});

test("forgot-password service methods use the exact paths and payload field names", () => {
  const resetMethod = serviceSource.slice(
    serviceSource.indexOf("  async resetPassword("),
    serviceSource.indexOf("  async checkEmailVerification("),
  );
  const addEmailMethod = serviceSource.slice(
    serviceSource.indexOf("  async addRecoveryEmail("),
    serviceSource.indexOf("  async verifyForgotPasswordOtp("),
  );
  assert.match(serviceSource, /apiRequest<unknown>\("\/auth\/forgot-password"/);
  assert.match(serviceSource, /body: JSON\.stringify\(identifierBody\(identifier\)\)/);
  assert.match(addEmailMethod, /apiRequest\("\/auth\/forgot-password\/add-email"/);
  assert.match(addEmailMethod, /JSON\.stringify\(\{ email, phone \}\)/);
  assert.match(addEmailMethod, /skipUnauthenticatedNotify: true/);
  assert.match(serviceSource, /apiRequest\("\/auth\/forgot-password\/verify-otp"/);
  // Verify and reset send one recovery-identity field, like forgot-password.
  assert.match(serviceSource, /JSON\.stringify\(\{ \.\.\.identifierBody\(target\), code \}\)/);
  assert.match(resetMethod, /\.\.\.identifierBody\(target\),\s*code,/);
  assert.match(serviceSource, /apiRequest\("\/auth\/reset-password"/);
  assert.match(resetMethod, /"password_confirmation": passwordConfirmation/);
  assert.doesNotMatch(resetMethod, /password-confirmation/);
});

test("recovery OTP remains a six-character string and registration reuses shared phone UI", () => {
  assert.match(screenSource, /setRecoveryCode\(value\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\)\)/);
  // Verify and reset are keyed by this attempt's recovery identity
  // (`recoveryTarget`: the address the code was sent to, else the bound
  // phone), never a live field.
  assert.match(screenSource, /const codeTarget = recoveryTarget\(recovery\);/);
  assert.match(
    screenSource,
    /verifyForgotPasswordOtp\(codeTarget, recoveryCode\)/,
  );
  assert.match(
    screenSource,
    /resetPassword\(\s*codeTarget,\s*recoveryCode,\s*recoveryPassword,\s*recoveryPasswordConfirmation,?\s*\)/,
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

test("registration sends email only when one is given, and requires a valid phone", () => {
  const registerMethod = serviceSource.slice(
    serviceSource.indexOf("  async register("),
    serviceSource.indexOf("  async me("),
  );
  assert.match(registerMethod, /email: string \| null,/);
  assert.match(registerMethod, /\.\.\.\(email \? \{ email \} : \{\}\),/);
  const register = screenSource.slice(screenSource.indexOf(`if (mode === "register") {`), screenSource.indexOf(`if (mode === "otp") {`));
  assert.match(register, /if \(registrationEmail && !isValidRecoveryEmail\(registrationEmail\)\)/);
  assert.match(register, /registrationEmail \|\| null,/);
  assert.match(register, /if \(registrationPhone\.validation !== "valid"\)/);
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
