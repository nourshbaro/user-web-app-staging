import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingBluePaymentAttempt,
  invalidatePendingBluePaymentAttemptUnlessSession,
  readPendingBluePaymentAttempt,
  savePendingBluePaymentAttempt,
} from "./bluePaymentHandoff.ts";

test.afterEach(() => clearPendingBluePaymentAttempt());

test("reuses the pending BLUE attempt only for its active cart session", () => {
  savePendingBluePaymentAttempt({
    sessionId: "cart-a",
    paymentUrl: "https://pay.example/attempt-123",
    orderId: "123",
  });

  assert.equal(readPendingBluePaymentAttempt("cart-a")?.orderId, "123");
  assert.equal(readPendingBluePaymentAttempt("cart-b"), null);
});

test("a changed or expired cart session invalidates BLUE reuse", () => {
  savePendingBluePaymentAttempt({
    sessionId: "cart-a",
    paymentUrl: "https://pay.example/attempt-123",
  });

  invalidatePendingBluePaymentAttemptUnlessSession("cart-b");
  assert.equal(readPendingBluePaymentAttempt("cart-a"), null);
});

test("the same session keeps its reusable BLUE attempt", () => {
  savePendingBluePaymentAttempt({
    sessionId: "cart-a",
    paymentUrl: "https://pay.example/attempt-123",
  });

  invalidatePendingBluePaymentAttemptUnlessSession("cart-a");
  assert.equal(
    readPendingBluePaymentAttempt("cart-a")?.paymentUrl,
    "https://pay.example/attempt-123",
  );
});
