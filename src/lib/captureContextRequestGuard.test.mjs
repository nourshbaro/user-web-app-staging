import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCaptureContextRequest,
  invalidateCaptureContextRequestRefs,
  releaseCaptureContextRetry,
  shouldInitializeCaptureContext,
} from "./captureContextRequestGuard.ts";

function createCaptureRequestHarness() {
  const captureSessionRef = { current: null };
  const captureRetrySessionRef = { current: null };
  let requestStarts = 0;

  const start = (sessionId, force = false) => {
    const started = beginCaptureContextRequest(
      captureSessionRef,
      captureRetrySessionRef,
      sessionId,
      force,
    );

    if (started) requestStarts += 1;
    return started;
  };

  return {
    captureSessionRef,
    captureRetrySessionRef,
    get requestStarts() {
      return requestStarts;
    },
    initialize(paymentMethod, sessionId) {
      if (!shouldInitializeCaptureContext(paymentMethod, sessionId)) return false;
      return start(sessionId);
    },
    retry(sessionId) {
      return start(sessionId, true);
    },
    finishRetry(sessionId) {
      releaseCaptureContextRetry(captureRetrySessionRef, sessionId, true);
    },
    replaceSession(sessionId) {
      invalidateCaptureContextRequestRefs(
        captureSessionRef,
        captureRetrySessionRef,
        sessionId,
      );
    },
  };
}

test("Blue checkout entry and rerenders do not start capture context", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.initialize("blue", "session-a"), false);
  assert.equal(harness.initialize("blue", "session-a"), false);
  assert.equal(harness.initialize("blue", "session-a"), false);
  assert.equal(harness.requestStarts, 0);
});

test("first CyberSource selection starts exactly one ordinary request", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.initialize("blue", "session-a"), false);
  assert.equal(harness.initialize("cybersource", "session-a"), true);
  assert.equal(harness.requestStarts, 1);
});

test("same-session initialization does not duplicate a pending request", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.initialize("cybersource", "session-a"), true);
  assert.equal(harness.initialize("cybersource", "session-a"), false);
  assert.equal(harness.requestStarts, 1);
});

test("switching away from and back to CyberSource reuses the same-session request", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.initialize("cybersource", "session-a"), true);
  assert.equal(harness.initialize("blue", "session-a"), false);
  assert.equal(harness.initialize("cybersource", "session-a"), false);
  assert.equal(harness.requestStarts, 1);
});

test("session replacement while Blue is selected does not start capture context", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.initialize("cybersource", "session-a"), true);
  assert.equal(harness.initialize("blue", "session-a"), false);

  harness.replaceSession("session-b");

  assert.equal(harness.captureSessionRef.current, null);
  assert.equal(harness.initialize("blue", "session-b"), false);
  assert.equal(harness.requestStarts, 1);
});

test("session replacement while CyberSource is selected starts exactly one new request", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.initialize("cybersource", "session-a"), true);

  harness.replaceSession("session-b");

  assert.equal(harness.initialize("cybersource", "session-b"), true);
  assert.equal(harness.initialize("cybersource", "session-b"), false);
  assert.equal(harness.requestStarts, 2);
});

test("rapid forced retries start only one replacement request", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.retry("session-a"), true);
  assert.equal(harness.retry("session-a"), false);
  assert.equal(harness.retry("session-a"), false);
  assert.equal(harness.requestStarts, 1);
});

test("forced retry ownership is released after success or failure", () => {
  for (const outcome of ["success", "failure"]) {
    const harness = createCaptureRequestHarness();

    assert.equal(harness.retry("session-a"), true, outcome);
    harness.finishRetry("session-a");
    assert.equal(harness.retry("session-a"), true, outcome);
    assert.equal(harness.requestStarts, 2, outcome);
  }
});

test("session replacement releases the old retry without unlocking the new retry", () => {
  const harness = createCaptureRequestHarness();

  assert.equal(harness.retry("session-a"), true);

  harness.replaceSession("session-b");

  assert.equal(harness.captureRetrySessionRef.current, null);
  assert.equal(harness.retry("session-b"), true);

  harness.finishRetry("session-a");

  assert.equal(harness.captureRetrySessionRef.current, "session-b");
  assert.equal(harness.retry("session-b"), false);
  assert.equal(harness.requestStarts, 2);
});