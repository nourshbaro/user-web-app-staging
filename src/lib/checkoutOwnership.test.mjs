import assert from "node:assert/strict";
import test from "node:test";
import {
  createCheckoutBilling,
  getActiveBillingForm,
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

test("user A billing data is inactive for user B even with matching visible fields", () => {
  const userA = {
    owner: "id:1",
    name: "Same",
    email: "same@example.com",
    phoneCountry: "PS",
    phoneNationalValue: "0599 123 456",
    canonicalPhone: "+970599123456",
  };
  const userB = {
    owner: "id:2",
    name: "Same",
    email: "same@example.com",
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
  };

  assert.deepEqual(getActiveBillingForm(userA, "id:2", userB), userB);
});

test("logout makes authenticated billing data inactive", () => {
  const userA = {
    owner: "id:1",
    name: "User A",
    email: "a@example.com",
    phoneCountry: "FR",
    phoneNationalValue: "06 12 34 56 78",
    canonicalPhone: "+33612345678",
  };
  const guest = {
    owner: null,
    name: "",
    email: "",
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
  };

  assert.deepEqual(getActiveBillingForm(userA, null, guest), guest);
});

test("current-user billing result is active", () => {
  const current = {
    owner: "id:2",
    name: "User B",
    email: "b@example.com",
    phoneCountry: "US",
    phoneNationalValue: "(202) 555-0123",
    canonicalPhone: "+12025550123",
  };

  assert.equal(getActiveBillingForm(current, "id:2", current), current);
});

test("current-user edited billing phone values remain active together", () => {
  const edited = {
    owner: "id:2",
    name: "Edited",
    email: "edited@example.com",
    phoneCountry: "PS",
    phoneNationalValue: "0599 123 456",
    canonicalPhone: "+970599123456",
  };
  const fallback = {
    owner: "id:2",
    name: "Original",
    email: "original@example.com",
    phoneCountry: "LB",
    phoneNationalValue: "",
    canonicalPhone: null,
  };

  assert.equal(getActiveBillingForm(edited, "id:2", fallback), edited);
});

test("stale owner cannot publish any phone-country state", () => {
  const stale = {
    owner: "id:1",
    name: "Stale",
    email: "stale@example.com",
    phoneCountry: "FR",
    phoneNationalValue: "06 12 34 56 78",
    canonicalPhone: "+33612345678",
  };
  const active = {
    owner: "id:2",
    name: "Active",
    email: "active@example.com",
    phoneCountry: "LB",
    phoneNationalValue: "71 123 456",
    canonicalPhone: "+96171123456",
  };

  const result = getActiveBillingForm(stale, "id:2", active);

  assert.equal(result.phoneCountry, "LB");
  assert.equal(result.phoneNationalValue, "71 123 456");
  assert.equal(result.canonicalPhone, "+96171123456");
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
