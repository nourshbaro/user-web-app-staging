import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createCheckoutBilling,
  getActiveCaptureState,
} from "./checkoutOwnership.ts";

test("session A capture state is inactive for session B", () => {
  assert.equal(getActiveCaptureState({ sessionId: "A", status: "ready", context: "context-a" }, "B"), null);
});

test("prior capture state is inactive for a null session", () => {
  assert.equal(getActiveCaptureState({ sessionId: "A", status: "error", error: "failed" }, null), null);
});

test("the current session capture context is active", () => {
  assert.deepEqual(
    getActiveCaptureState({ sessionId: "B", status: "ready", context: "context-b" }, "B"),
    { sessionId: "B", status: "ready", context: "context-b" },
  );
});

test("checkout billing rejects a missing canonical phone", () => {
  assert.equal(
    createCheckoutBilling("Buyer", "buyer@example.com", null),
    null,
  );
});

test("checkout billing always retains Lebanon as billing country", () => {
  const cases = [
    { label: "Lebanon", phone: "+96171123456" },
    { label: "Palestine", phone: "+970599123456" },
    { label: "France", phone: "+33612345678" },
    { label: "United States", phone: "+12025550123" },
  ];

  for (const { label, phone } of cases) {
    const billing = createCheckoutBilling(
      `${label} Buyer`,
      "buyer@example.com",
      phone,
    );

    assert.deepEqual(billing, {
      name: `${label} Buyer`,
      email: "buyer@example.com",
      phone,
      country: "LB",
    });
  }
});

test("checkout maps billing fields from the current authenticated user", async () => {
  const source = await readFile(new URL("../app/checkout.tsx", import.meta.url), "utf8");

  assert.match(source, /const name = auth\.user\?\.name\.trim\(\) \?\? ""/);
  // Null-safe: a phone-only account has `email: null` (email is optional at registration).
  assert.match(source, /const email = auth\.user\?\.email\?\.trim\(\) \?\? ""/);
  assert.match(source, /auth\.user\?\.phone \?\? ""/);
  assert.match(source, /createCheckoutBilling\(name, email, canonicalPhone\)/);
  assert.doesNotMatch(source, /billingForm|billingInfo|profileService/);
  assert.doesNotMatch(source, /\/portal\/billing-info/);
});

test("checkout refreshes the shared auth profile on focus and blocks while it refreshes", async () => {
  const source = await readFile(new URL("../app/checkout.tsx", import.meta.url), "utf8");

  assert.match(source, /void refreshUser\(\)\.catch/);
  assert.match(source, /loading \|\| auth\.isRefreshingUser/);
});
