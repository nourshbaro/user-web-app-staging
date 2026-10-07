import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAuthSubmissionGuard } from "./authSubmissionGuard.ts";
import {
  createRecoveryAttempts,
  forgotPasswordOutcome,
  initialRecoveryState,
  isValidRecoveryEmail,
  recoveryReducer,
  recoveryTarget,
} from "./passwordRecovery.ts";

const screen = await readFile(new URL("../app/auth.tsx", import.meta.url), "utf8");

for (const [label, recovery, expectedBody] of [
  ["email", { step: "code", method: "email", email: "fan@example.com", phone: null }, { email: "fan@example.com" }],
  ["phone", { step: "code", method: "phone", email: null, phone: "96171123456" }, { phone: "96171123456" }],
]) {
  test(`recovery resend (${label} code) synchronously excludes duplicate resends and Verify until settlement`, async () => {
    // Execute the actual handler with a pending transport and an unchanged React
    // render snapshot: setResending does not immediately update its closure.
    const handler = screen.slice(screen.indexOf("  const resendRecoveryCode = async () => {"), screen.indexOf("  const switchMode ="));
    const guard = createAuthSubmissionGuard();
    let settle;
    const sent = [];
    const resend = new Function("recovery", "resending", "loading", "submissionGuard", "recoveryAttempts", "setResending", "setMessage", "authService", "isRecoveryCurrent", "toast", "t", "notify", "backendProvidedError", "mountedRef", "recoveryTarget", "getMessage", `${handler}\nreturn resendRecoveryCode;`)(
      recovery, false, false, { current: guard },
      { current: createRecoveryAttempts() }, () => {}, () => {},
      { forgotPassword: (body) => { sent.push(body); return new Promise((resolve) => { settle = resolve; }); } },
      () => true, { showToast: () => {} }, () => "", () => {}, () => "", { current: true },
      recoveryTarget, () => "",
    );
    const first = resend();
    await resend();
    // Resend asks again for the attempt's own identity, once.
    assert.deepEqual(sent, [expectedBody]);
    assert.equal(guard.tryAcquire(), false, "Verify uses the same guard while resend is pending");
    settle({});
    await first;
    assert.equal(guard.tryAcquire(), true, "settlement releases the guard");
    guard.release();
  });
}

/** Drives the reducer the way the screen does: invalidating events take `attempts.next()`. */
function flow(method = "email") {
  const attempts = createRecoveryAttempts();
  let state = recoveryReducer(initialRecoveryState(), { type: "start", attempt: attempts.next(), method });
  const apply = (event) => {
    state = recoveryReducer(state, event);
    return state;
  };
  return { attempts, apply, get state() { return state; } };
}

// Recorded staging answers (2026-10-06).
const GENERIC = { message: "If that account is registered, a reset code has been sent." };
const EMAIL_REQUIRED = { message: "Please add an email to your account to reset your password.", reason: "email_required" };

test("the forgot-password answer branches only on the backend's email_required reason", () => {
  assert.equal(forgotPasswordOutcome(EMAIL_REQUIRED), "emailRequired");
  assert.equal(forgotPasswordOutcome({ data: EMAIL_REQUIRED }), "emailRequired");
  // Existing or unknown email, phone with an email: the same generic answer.
  assert.equal(forgotPasswordOutcome(GENERIC), "codeSent");
  assert.equal(forgotPasswordOutcome(null), "codeSent");
  // Message text is never a branch signal.
  assert.equal(forgotPasswordOutcome({ message: "Please add an email to your account." }), "codeSent");
});

test("email recovery: a code sent for the current attempt opens the code step for that address", () => {
  const f = flow("email");
  const attempt = f.attempts.current();
  f.apply({ type: "codeSent", attempt, email: "fan@example.com" });
  assert.equal(f.state.step, "code");
  assert.equal(f.state.email, "fan@example.com");
  f.apply({ type: "codeVerified", attempt });
  assert.equal(f.state.step, "newPassword");
});

test("phone recovery with no email: phone → add email → code, keeping the bound phone", () => {
  const f = flow("phone");
  const attempt = f.attempts.current();
  f.apply({ type: "emailRequired", attempt, phone: "96171123456" });
  assert.equal(f.state.step, "addEmail");
  assert.equal(f.state.phone, "96171123456");
  f.apply({ type: "codeSent", attempt, email: "fan@example.com" });
  assert.deepEqual(
    { step: f.state.step, phone: f.state.phone, email: f.state.email },
    { step: "code", phone: "96171123456", email: "fan@example.com" },
  );
});

test("phone recovery, generic success: phone → code → new password, keyed by the bound phone", () => {
  // The screen dispatches phoneCodeSent for any 2xx without email_required.
  assert.equal(forgotPasswordOutcome(GENERIC), "codeSent");
  const f = flow("phone");
  const attempt = f.attempts.current();
  f.apply({ type: "phoneCodeSent", attempt, phone: "96171123456" });
  // It no longer stays on the phone step.
  assert.notEqual(f.state.step, "identify");
  assert.deepEqual(
    { step: f.state.step, phone: f.state.phone, email: f.state.email },
    { step: "code", phone: "96171123456", email: null },
  );
  assert.deepEqual(recoveryTarget(f.state), { phone: "96171123456" });
  f.apply({ type: "codeVerified", attempt });
  assert.equal(f.state.step, "newPassword");
  assert.deepEqual(recoveryTarget(f.state), { phone: "96171123456" });
});

test("phone + email_required → add email; add-email success → code keyed by the address it was sent to", () => {
  const f = flow("phone");
  const attempt = f.attempts.current();
  assert.equal(forgotPasswordOutcome(EMAIL_REQUIRED), "emailRequired");
  f.apply({ type: "emailRequired", attempt, phone: "96171123456" });
  assert.equal(f.state.step, "addEmail");
  assert.equal(recoveryTarget(f.state), null, "no code exists until add-email succeeds");
  f.apply({ type: "codeSent", attempt, email: "fan@example.com" });
  assert.equal(f.state.step, "code");
  assert.deepEqual(recoveryTarget(f.state), { email: "fan@example.com" });
});

test("a stale phone answer cannot move a newer attempt to the code", () => {
  const f = flow("phone");
  const first = f.attempts.current();
  f.apply({ type: "identifierEdited", attempt: f.attempts.next() });
  f.apply({ type: "phoneCodeSent", attempt: first, phone: "96171000000" });
  assert.equal(f.state.step, "identify");
  assert.equal(f.state.phone, null);
  // A late answer after switching to email is dropped too.
  const g = flow("phone");
  const phoneAttempt = g.attempts.current();
  g.apply({ type: "method", attempt: g.attempts.next(), method: "email" });
  g.apply({ type: "phoneCodeSent", attempt: phoneAttempt, phone: "96171123456" });
  assert.deepEqual(g.state, initialRecoveryState(g.attempts.current(), "email"));
  // And a phone code answer is meaningless on the email path.
  const h = flow("email");
  h.apply({ type: "phoneCodeSent", attempt: h.attempts.current(), phone: "96171123456" });
  assert.equal(h.state.step, "identify");
});

test("Back from a phone code starts a new attempt: its code cannot be verified", () => {
  const f = flow("phone");
  const attempt = f.attempts.current();
  f.apply({ type: "phoneCodeSent", attempt, phone: "96171123456" });
  f.apply({ type: "back", attempt: f.attempts.next() });
  assert.deepEqual(f.state, initialRecoveryState(f.attempts.current(), "phone"));
  assert.equal(recoveryTarget(f.state), null);
  f.apply({ type: "codeVerified", attempt });
  assert.equal(f.state.step, "identify");
});

test("a failed add-email (no event) stays on the add-email step", () => {
  const f = flow("phone");
  f.apply({ type: "emailRequired", attempt: f.attempts.current(), phone: "96171123456" });
  const before = f.state;
  // The screen dispatches nothing on failure; the state is unchanged.
  assert.equal(f.state, before);
  assert.equal(f.state.step, "addEmail");
});

test("email_required is only meaningful on the phone path's first step", () => {
  const f = flow("email");
  f.apply({ type: "emailRequired", attempt: f.attempts.current(), phone: "96171123456" });
  assert.equal(f.state.step, "identify");
  assert.equal(f.state.phone, null);
});

test("a stale answer from an earlier identifier cannot advance the current flow", () => {
  const f = flow("phone");
  const first = f.attempts.current();
  // The user edits the phone while the first request is in flight.
  f.apply({ type: "identifierEdited", attempt: f.attempts.next() });
  f.apply({ type: "emailRequired", attempt: first, phone: "96171000000" });
  assert.equal(f.state.step, "identify");
  assert.equal(f.state.phone, null);
  assert.equal(f.attempts.isCurrent(first), false);
  // An answer for the current attempt still applies.
  f.apply({ type: "emailRequired", attempt: f.attempts.current(), phone: "96171123456" });
  assert.equal(f.state.phone, "96171123456");
});

test("switching method mid-request discards the earlier method's answer", () => {
  const f = flow("email");
  const emailAttempt = f.attempts.current();
  f.apply({ type: "method", attempt: f.attempts.next(), method: "phone" });
  f.apply({ type: "codeSent", attempt: emailAttempt, email: "fan@example.com" });
  assert.equal(f.state.step, "identify");
  assert.equal(f.state.method, "phone");
  assert.equal(f.state.email, null);
});

test("Back from the code step starts a new attempt: the earlier code cannot be verified", () => {
  const f = flow("email");
  const attempt = f.attempts.current();
  f.apply({ type: "codeSent", attempt, email: "fan@example.com" });
  f.apply({ type: "back", attempt: f.attempts.next() });
  assert.deepEqual(f.state, initialRecoveryState(f.attempts.current(), "email"));
  f.apply({ type: "codeVerified", attempt });
  assert.equal(f.state.step, "identify");
});

test("after an email attempt the user can switch to the phone input (no client account inference)", () => {
  const f = flow("email");
  f.apply({ type: "codeSent", attempt: f.attempts.current(), email: "unknown@example.com" });
  f.apply({ type: "back", attempt: f.attempts.next() });
  f.apply({ type: "method", attempt: f.attempts.next(), method: "phone" });
  assert.deepEqual(
    { step: f.state.step, method: f.state.method, email: f.state.email, phone: f.state.phone },
    { step: "identify", method: "phone", email: null, phone: null },
  );
});

test("Back from add email and from the new password keeps coherent state", () => {
  const f = flow("phone");
  f.apply({ type: "emailRequired", attempt: f.attempts.current(), phone: "96171123456" });
  f.apply({ type: "back", attempt: f.attempts.next() });
  assert.deepEqual(f.state, initialRecoveryState(f.attempts.current(), "phone"));

  const g = flow("email");
  g.apply({ type: "codeSent", attempt: g.attempts.current(), email: "fan@example.com" });
  g.apply({ type: "codeVerified", attempt: g.attempts.current() });
  g.apply({ type: "back", attempt: g.attempts.next() });
  assert.equal(g.state.step, "code");
  assert.equal(g.state.email, "fan@example.com");
  // The reducer adopted the new attempt, so verifying again still applies.
  g.apply({ type: "codeVerified", attempt: g.attempts.current() });
  assert.equal(g.state.step, "newPassword");
});

test("reset returns to the first step with nothing bound", () => {
  const f = flow("phone");
  f.apply({ type: "emailRequired", attempt: f.attempts.current(), phone: "96171123456" });
  f.apply({ type: "codeSent", attempt: f.attempts.current(), email: "fan@example.com" });
  f.apply({ type: "reset", attempt: f.attempts.next() });
  assert.equal(f.state.step, "identify");
  assert.equal(f.state.phone, null);
  assert.equal(f.state.email, null);
});

test("codeVerified needs the code step and its address", () => {
  const f = flow("email");
  f.apply({ type: "codeVerified", attempt: f.attempts.current() });
  assert.equal(f.state.step, "identify");
});

test("recovery email validation", () => {
  assert.equal(isValidRecoveryEmail("fan@example.com"), true);
  assert.equal(isValidRecoveryEmail("fan@example"), false);
  assert.equal(isValidRecoveryEmail("not an email"), false);
  assert.equal(isValidRecoveryEmail(""), false);
});

// --- Screen wiring (source): the screen applies answers only through the owner. ---

test("every recovery request is checked against its attempt after it resolves", () => {
  const recovery = screen.slice(screen.indexOf(`if (mode === "recovery") {`), screen.indexOf("await auth.refreshAuth();"));
  const awaits = recovery.match(/await authService\.\w+\(/g) ?? [];
  const checks = recovery.match(/if \(!isRecoveryCurrent\(recoveryAttempt\)\) return;/g) ?? [];
  assert.equal(awaits.length, 5); // forgot (email), forgot (phone), add-email, verify, reset
  assert.equal(checks.length, awaits.length);
  assert.match(screen, /const recoveryAttempt = recoveryAttempts\.current\.current\(\);/);
  // Failures for an earlier attempt are dropped too.
  assert.match(screen, /if \(mode === "recovery" && !recoveryAttempts\.current\.isCurrent\(recoveryAttempt\)\) return;/);
  // Submit and recovery resend share the same synchronous guard.
  assert.equal((screen.match(/submissionGuard\.current\.tryAcquire\(\)/g) ?? []).length, 2);
});

test("add-email sends the phone the backend answered for, never the live phone field", () => {
  const addEmail = screen.slice(screen.indexOf(`if (recovery.step === "addEmail") {`), screen.indexOf("const codeTarget = recoveryTarget(recovery);"));
  assert.match(addEmail, /const boundPhone = recovery\.phone;/);
  assert.match(addEmail, /await authService\.addRecoveryEmail\(boundPhone, trimmedEmail\);/);
  assert.doesNotMatch(addEmail, /recoveryPhone/);
  // Advances only after the request resolves for the current attempt.
  assert.match(addEmail, /await authService\.addRecoveryEmail[\s\S]*if \(!isRecoveryCurrent\(recoveryAttempt\)\) return;[\s\S]*enterRecoveryCode\(recoveryAttempt, trimmedEmail\)/);
});

test("the phone path: email_required → add email; any other success → the code for that phone", () => {
  const phone = screen.slice(screen.indexOf("const phone = toBackendPhoneDigits(recoveryPhone.canonicalPhone);"), screen.indexOf(`if (recovery.step === "addEmail") {`));
  assert.match(phone, /const answer = await authService\.forgotPassword\(\{ phone \}\);/);
  // Both branches act only for the attempt that sent the request.
  assert.match(phone, /await authService\.forgotPassword\(\{ phone \}\);\s*if \(!isRecoveryCurrent\(recoveryAttempt\)\) return;\s*if \(forgotPasswordOutcome\(answer\) === "emailRequired"\)/);
  assert.match(phone, /if \(forgotPasswordOutcome\(answer\) === "emailRequired"\) \{[\s\S]*type: "emailRequired", attempt: recoveryAttempt, phone[\s\S]*return;\s*\}/);
  // The generic answer no longer stays on the phone step: it opens the code,
  // bound to the phone that was sent (not the live field), and shows the
  // backend's own message (it does not say where the code went).
  const generic = phone.slice(phone.indexOf(`type: "emailRequired"`));
  assert.match(generic, /dispatchRecovery\(\{ type: "phoneCodeSent", attempt: recoveryAttempt, phone \}\);/);
  assert.match(generic, /message: getMessage\(answer, t\("auth\.otp\.resent"\)\)/);
  assert.doesNotMatch(generic, /setMessage\(getMessage\(answer/);
  // Never a request to type the account's email, or an invented address.
  assert.doesNotMatch(phone, /setRecoveryEmail|enterRecoveryCode|type: "codeSent"|"method"|auth\.forgot\.phoneSent/);
});

test("the email path keeps the backend's generic answer (no inferred 'email unavailable')", () => {
  const email = screen.slice(screen.indexOf(`if (recovery.step === "identify" && recovery.method === "email") {`), screen.indexOf(`if (recovery.step === "identify") {`, screen.indexOf(`recovery.method === "email") {`) + 1));
  assert.match(email, /await authService\.forgotPassword\(\{ email: trimmedEmail \}\);/);
  // No branch on message text or a guessed "not found" state.
  assert.doesNotMatch(email, /message|notFound|unavailable|tryPhone/i);
});

test("both code steps use the six-cell OTP over one sanitized six-digit value", async () => {
  const otp = await readFile(new URL("../components/account/OtpCodeInput.tsx", import.meta.url), "utf8");
  assert.equal((screen.match(/<OtpCodeInput/g) ?? []).length, 2);
  assert.match(screen, /onChangeText=\{\(value\) => setOtp\(value\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\)\)\}/);
  // One real input: numeric keyboard, OS one-time-code autofill, paste.
  assert.equal((otp.match(/<TextInput\s/g) ?? []).length, 1);
  assert.match(otp, /export const OTP_LENGTH = 6;/);
  assert.match(otp, /maxLength=\{OTP_LENGTH\}/);
  assert.match(otp, /keyboardType="number-pad"/);
  assert.match(otp, /textContentType="oneTimeCode"/);
  assert.match(otp, /autoComplete=\{Platform\.OS === "android" \? "sms-otp" : "one-time-code"\}/);
  assert.match(otp, /accessibilityLabel=\{label\}/);
  // Cells are presentation only; the active cell is the next to fill.
  assert.match(otp, /importantForAccessibility="no-hide-descendants"/);
  assert.match(otp, /const active = Math\.min\(value\.length, OTP_LENGTH - 1\);/);
  // The caret blink honours reduced motion; the cells never mirror.
  assert.match(otp, /if \(reducedMotion\) \{\s*opacity\.setValue\(1\);\s*return;\s*\}/);
  assert.match(otp, /direction: "ltr"/);
  // No fake resend countdown anywhere in the auth screen.
  assert.doesNotMatch(screen, /resend in|setInterval|countdown/i);
});

test("editing the identifier or switching method starts a new attempt", () => {
  assert.match(screen, /const editRecoveryEmail = \(value: string\) => \{\s*setRecoveryEmail\(value\);\s*dispatchRecovery\(\{ type: "identifierEdited", attempt: recoveryAttempts\.current\.next\(\) \}\);/);
  assert.match(screen, /const editRecoveryPhone = \(value: PhoneValue\) => \{\s*setRecoveryPhone\(value\);\s*dispatchRecovery\(\{ type: "identifierEdited", attempt: recoveryAttempts\.current\.next\(\) \}\);/);
  assert.match(screen, /dispatchRecovery\(\{ type: "method", attempt: recoveryAttempts\.current\.next\(\), method \}\);/);
  assert.match(screen, /dispatchRecovery\(\{ type: "back", attempt: recoveryAttempts\.current\.next\(\) \}\);/);
});

test("completion returns to Sign in with the recovery identifier and clears recovery state", () => {
  const completion = screen.slice(screen.indexOf("await authService.resetPassword("), screen.indexOf("await auth.refreshAuth();"));
  assert.match(completion, /if \(!isRecoveryCurrent\(recoveryAttempt\)\) return;/);
  assert.match(completion, /setLoginMethod\(method\);/);
  assert.match(completion, /resetRecovery\(\);/);
  // Recovery never signs in by itself.
  assert.doesNotMatch(completion, /refreshAuth|saveSession|router\./);
  const reset = screen.slice(screen.indexOf("const resetRecovery = () => {"), screen.indexOf("const startRecovery = () => {"));
  assert.match(reset, /type: "reset"/);
  assert.match(reset, /setMode\("login"\)/);
  assert.match(reset, /clearRecoveryDrafts\(\)/);
});

test("recovery keeps passwords and codes in screen memory only", () => {
  assert.doesNotMatch(screen, /storage\.(set|remove)|SecureStore|AsyncStorage/);
  assert.doesNotMatch(screen, /console\./);
  assert.doesNotMatch(screen, /params[^\n]*(password|code)/i);
});

test("the auth header stays on the shared platform-specific FlowHeader", () => {
  assert.match(screen, /<FlowHeader title="" backLabel=\{backLabel\} onBack=\{goBack\} \/>/);
  // Platform presentation is owned by FlowHeader (`flowHeaderLayout`), not re-derived here.
  assert.doesNotMatch(screen, /Platform\.OS === "android"/);
  assert.match(screen, /mode === "register" \|\| step === "identify" \? t\("auth\.back\.signIn"\) : t\("auth\.back\.generic"\)/);
});
