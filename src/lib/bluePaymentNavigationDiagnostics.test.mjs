import assert from "node:assert/strict";
import test from "node:test";
import {
  createBlueNavigationDiagnostic,
  terminalHandledDecision,
} from "./bluePaymentNavigationDiagnostics.ts";

const dynamicPaymentId = "pay_7be824f7-secret";
const baseContext = {
  callback: "onShouldStartLoadWithRequest",
  navigationType: "other",
  isTopFrame: true,
  terminalResult: null,
  terminalAlreadyHandled: false,
  decision: "navigation_received",
};

function diagnostic(url, overrides = {}) {
  return createBlueNavigationDiagnostic(url, { ...baseContext, ...overrides });
}

function serialized(metadata) {
  return JSON.stringify(metadata);
}

test("HTTPS payment URL exposes only its host and redacted payment path shape", () => {
  const metadata = diagnostic(`https://payments.example/payment/${dynamicPaymentId}?token=secret#private`);

  assert.equal(metadata.scheme, "https");
  assert.equal(metadata.host, "payments.example");
  assert.equal(metadata.pathShape, "/payment/<redacted>");
  assert.doesNotMatch(serialized(metadata), new RegExp(dynamicPaymentId));
});

test("trusted success path remains recognizable without its query", () => {
  const metadata = diagnostic("https://lfa.example/payment/success?token=secret", {
    terminalResult: "success",
    decision: "terminal_success",
  });

  assert.equal(metadata.pathShape, "/payment/success");
  assert.equal(metadata.terminalResult, "success");
  assert.doesNotMatch(serialized(metadata), /token|secret/);
});

test("trusted failure path remains recognizable without its query", () => {
  const metadata = diagnostic("https://lfa.example/payment/failed?reference=secret", {
    terminalResult: "failed",
    decision: "terminal_failed",
  });

  assert.equal(metadata.pathShape, "/payment/failed");
  assert.equal(metadata.terminalResult, "failed");
  assert.doesNotMatch(serialized(metadata), /reference|secret/);
});

test("app custom scheme omits sensitive query data", () => {
  const metadata = diagnostic("lfa-app://checkout/success?payment_id=secret");

  assert.equal(metadata.scheme, "lfa-app");
  assert.equal(metadata.host, "checkout");
  assert.equal(metadata.pathShape, "/<redacted>");
  assert.doesNotMatch(serialized(metadata), /payment_id|secret/);
});

test("Expo Go URL keeps only host and safe structural path", () => {
  const metadata = diagnostic("exp://192.0.2.1:8081/--/checkout/success?secret=value");

  assert.equal(metadata.scheme, "exp");
  assert.equal(metadata.host, "192.0.2.1");
  assert.equal(metadata.pathShape, "/--/<redacted>");
  assert.doesNotMatch(serialized(metadata), /8081|secret|value|checkout/);
});

test("bank custom scheme redacts host, payment identifier, and query", () => {
  const metadata = diagnostic(`bank-wallet://${dynamicPaymentId}/approve?token=secret`);

  assert.equal(metadata.scheme, "bank-wallet");
  assert.equal(metadata.host, null);
  assert.equal(metadata.pathShape, "/<redacted>");
  assert.doesNotMatch(serialized(metadata), new RegExp(`${dynamicPaymentId}|token|secret`));
});

test("intent URL exposes no embedded package, fallback, or identifier", () => {
  const metadata = diagnostic(
    `intent://pay/${dynamicPaymentId}#Intent;scheme=bank;package=com.example.bank;S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fsecret;end`,
    { decision: "blocked_dangerous_scheme" },
  );

  assert.equal(metadata.scheme, "intent");
  assert.equal(metadata.host, null);
  assert.equal(metadata.pathShape, "/<redacted>");
  assert.doesNotMatch(serialized(metadata), /com\.example|fallback|example\.com|secret|pay_7be/);
});

test("invalid URL produces bounded invalid metadata", () => {
  const metadata = diagnostic("not a URL with secret data", { decision: "invalid_url" });

  assert.equal(metadata.scheme, "invalid");
  assert.equal(metadata.host, null);
  assert.equal(metadata.pathShape, "/<invalid>");
  assert.ok(serialized(metadata).length < 320);
  assert.doesNotMatch(serialized(metadata), /secret data/);
});

test("credentials are never represented in metadata", () => {
  const metadata = diagnostic("https://private-user:private-password@example.com/payment/success");

  assert.equal(metadata.host, "example.com");
  assert.doesNotMatch(serialized(metadata), /private-user|private-password/);
});

test("very long paths remain bounded", () => {
  const metadata = diagnostic(`https://example.com/${"sensitive".repeat(1000)}`);

  assert.equal(metadata.pathShape, "/<redacted>");
  assert.ok(metadata.pathShape.length < 32);
  assert.ok(serialized(metadata).length < 320);
});

test("fragments and the raw URL are absent from serialized metadata", () => {
  const rawUrl = "https://example.com/payment/success?token=secret#private-fragment";
  const metadata = diagnostic(rawUrl);

  assert.doesNotMatch(serialized(metadata), /token|secret|fragment/);
  assert.ok(!serialized(metadata).includes(rawUrl));
});

test("unknown callback and navigation type are bounded", () => {
  const metadata = diagnostic("https://example.com/", {
    callback: "raw-callback-secret",
    navigationType: "raw-navigation-secret",
  });

  assert.equal(metadata.callback, "unknown");
  assert.equal(metadata.navigationType, "unknown");
  assert.doesNotMatch(serialized(metadata), /raw-|secret/);
});

test("terminal-already-handled navigation produces the ignored decision", () => {
  assert.equal(terminalHandledDecision(true), "ignored_after_terminal");
  assert.equal(terminalHandledDecision(false), null);
});

test("success followed by an unknown scheme cannot select a permanent error", () => {
  const state = { terminal: "success", error: null };
  const decision = terminalHandledDecision(Boolean(state.terminal));
  if (decision !== "ignored_after_terminal") state.error = "unsupported";

  assert.equal(decision, "ignored_after_terminal");
  assert.equal(state.terminal, "success");
  assert.equal(state.error, null);
});

test("failure followed by an unknown scheme cannot override the terminal route", () => {
  const state = { terminal: "failed", error: null };
  const decision = terminalHandledDecision(Boolean(state.terminal));
  if (decision !== "ignored_after_terminal") state.error = "unsupported";

  assert.equal(decision, "ignored_after_terminal");
  assert.equal(state.terminal, "failed");
  assert.equal(state.error, null);
});
