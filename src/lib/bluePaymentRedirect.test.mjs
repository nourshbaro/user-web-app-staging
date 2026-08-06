import assert from "node:assert/strict";
import test from "node:test";
import {
  blueResultDisplayParams,
  classifyBlueTerminalUrl,
  decideBlueNavigation,
} from "./bluePaymentRedirect.ts";

const redirectOrigin = "https://lfa.matrixvert.com";
const classifyBlueWebViewCallback = (callback) => (
  classifyBlueTerminalUrl(callback, redirectOrigin, "blue-payment-webview")
);

test("exact app success callback without provider is terminal success", () => {
  assert.equal(classifyBlueWebViewCallback("lfa-app://checkout/success"), "success");
});

test("exact app failure callback without provider is terminal failure", () => {
  assert.equal(classifyBlueWebViewCallback("lfa-app://checkout/failed"), "failed");
});

test("exactly one provider=blue remains accepted for success and failure", () => {
  assert.equal(
    classifyBlueWebViewCallback("lfa-app://checkout/success?provider=blue"),
    "success",
  );
  assert.equal(
    classifyBlueWebViewCallback("lfa-app://checkout/failed?provider=blue"),
    "failed",
  );
});

test("app callback query ordering and safe display parameters do not affect classification", () => {
  const callback = "lfa-app://checkout/success?order_number=visible&provider=blue&status=paid";

  assert.equal(classifyBlueWebViewCallback(callback), "success");
  assert.deepEqual(blueResultDisplayParams(callback), { order_number: "visible" });
});

test("wrong, unknown, empty, and duplicate providers are rejected", () => {
  const rejected = [
    "lfa-app://checkout/success?provider=cybersource",
    "lfa-app://checkout/success?provider=unknown",
    "lfa-app://checkout/success?provider=",
    "lfa-app://checkout/success?provider=blue&provider=cybersource",
    "lfa-app://checkout/success?provider=blue&provider=blue",
  ];

  for (const callback of rejected) {
    assert.equal(classifyBlueWebViewCallback(callback), null);
  }
});

test("missing provider is accepted only in the Blue payment WebView context", () => {
  const callback = "lfa-app://checkout/success";

  assert.equal(classifyBlueTerminalUrl(callback, redirectOrigin), null);
  assert.equal(classifyBlueWebViewCallback(callback), "success");
});

test("wrong host and wrong schemes are rejected", () => {
  const rejected = [
    "lfa-app://anything-else/success?provider=blue",
    "bank-app://checkout/success?provider=blue",
    "exp://checkout/success?provider=blue",
  ];

  for (const callback of rejected) {
    assert.equal(classifyBlueWebViewCallback(callback), null);
  }
});

test("inexact app callback paths are rejected", () => {
  const rejected = [
    "lfa-app://checkout/unknown?provider=blue",
    "lfa-app://checkout/successful?provider=blue",
    "lfa-app://checkout/success/extra?provider=blue",
    "lfa-app://checkout/failed/extra?provider=blue",
    "lfa-app://checkout/success/?provider=blue",
  ];

  for (const callback of rejected) {
    assert.equal(classifyBlueWebViewCallback(callback), null);
  }
});

test("credentials and fragments are rejected", () => {
  const rejected = [
    "lfa-app://user:password@checkout/success?provider=blue",
    "lfa-app://checkout/success?provider=blue#fragment",
  ];

  for (const callback of rejected) {
    assert.equal(classifyBlueWebViewCallback(callback), null);
  }
});

test("encoded separators and traversal are rejected", () => {
  const rejected = [
    "lfa-app://checkout/%2Fsuccess?provider=blue",
    "lfa-app://checkout/%5Csuccess?provider=blue",
    "lfa-app://checkout/%2e%2e/success?provider=blue",
    "lfa-app://checkout/success%2Fextra?provider=blue",
  ];

  for (const callback of rejected) {
    assert.equal(classifyBlueWebViewCallback(callback), null);
  }
});

test("existing HTTPS terminal callbacks remain supported", () => {
  assert.equal(
    classifyBlueTerminalUrl("https://lfa.matrixvert.com/payment/success?reference=display", redirectOrigin),
    "success",
  );
  assert.equal(
    classifyBlueTerminalUrl("https://lfa.matrixvert.com/payment/failed", redirectOrigin),
    "failed",
  );
  assert.equal(
    classifyBlueTerminalUrl("https://wrong.example/payment/success", redirectOrigin),
    null,
  );
});

test("approved app callbacks are intercepted as terminal decisions", () => {
  const success = decideBlueNavigation(
    "lfa-app://checkout/success",
    redirectOrigin,
    false,
  );
  const failed = decideBlueNavigation(
    "lfa-app://checkout/failed",
    redirectOrigin,
    false,
  );

  assert.deepEqual(success, {
    terminalResult: "success",
    decision: "terminal_success",
    action: "handle_terminal",
  });
  assert.deepEqual(failed, {
    terminalResult: "failed",
    decision: "terminal_failed",
    action: "handle_terminal",
  });
  assert.notEqual(success.action, "allow_webview");
  assert.notEqual(success.action, "open_external");
  assert.notEqual(failed.action, "allow_webview");
  assert.notEqual(failed.action, "open_external");
  assert.notEqual(success.decision, "open_external_attempt");
  assert.notEqual(failed.decision, "open_external_attempt");
});

test("duplicate terminal callbacks and later unknown schemes are ignored", () => {
  const duplicateSuccess = decideBlueNavigation(
    "lfa-app://checkout/success",
    redirectOrigin,
    true,
  );
  const afterSuccess = decideBlueNavigation("bank-app://payment/secret", redirectOrigin, true);
  const afterFailure = decideBlueNavigation("another-app://payment/secret", redirectOrigin, true);

  assert.equal(duplicateSuccess.decision, "ignored_after_terminal");
  assert.equal(duplicateSuccess.action, "ignore");
  assert.equal(afterSuccess.decision, "ignored_after_terminal");
  assert.equal(afterSuccess.action, "ignore");
  assert.equal(afterFailure.decision, "ignored_after_terminal");
  assert.equal(afterFailure.action, "ignore");
});

test("unknown app routes and all other custom schemes remain blocked", () => {
  const rejected = [
    "lfa-app://checkout/unknown?provider=blue",
    "bank-app://checkout/success?provider=blue",
    "exp://checkout/success?provider=blue",
  ];

  for (const callback of rejected) {
    assert.deepEqual(
      decideBlueNavigation(callback, redirectOrigin, false),
      { terminalResult: null, decision: "blocked_unknown_scheme", action: "block" },
    );
  }
});

test("intent remains in the dangerous-scheme branch", () => {
  assert.deepEqual(
    decideBlueNavigation("intent://payment#Intent;package=com.example;end", redirectOrigin, false),
    { terminalResult: null, decision: "blocked_dangerous_scheme", action: "block" },
  );
});
