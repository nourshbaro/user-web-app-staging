import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const serviceUrl = new URL("./checkout.ts", import.meta.url);
const serviceSource = await readFile(serviceUrl, "utf8");
const callsKey = `__checkoutServiceCalls_${Date.now()}_${Math.random().toString(36).slice(2)}`;
globalThis[callsKey] = [];

const apiMockSource = `
export async function apiRequest(path, init) {
  const response = { path, method: init?.method, body: init?.body };
  globalThis[${JSON.stringify(callsKey)}].push(response);
  return response;
}
`;
const apiMockUrl = `data:text/javascript;base64,${Buffer.from(apiMockSource).toString("base64")}`;
const executableSource = ts.transpileModule(serviceSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText.replace('from "@/services/api"', `from ${JSON.stringify(apiMockUrl)}`);
const serviceModuleUrl = `data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}`;
const { checkoutService } = await import(serviceModuleUrl);

function takeOnlyCall() {
  assert.equal(globalThis[callsKey].length, 1);
  return globalThis[callsKey].shift();
}

test.after(() => {
  delete globalThis[callsKey];
});

test("Blue checkout preserves a canonical Lebanese phone and LB billing country", async () => {
  const payload = {
    checkout_session_id: "checkout-blue",
    billing: {
      name: "Blue Buyer",
      email: "blue@example.com",
      phone: "+96171123456",
      country: "LB",
    },
    tickets_by_match: {
      "42": [{ holder_name: "Blue Holder" }],
    },
    payment_method: "blue",
  };

  const response = await checkoutService.submit(payload);
  const call = takeOnlyCall();
  const serializedPayload = JSON.parse(call.body);

  assert.equal(call.path, "/checkout/mobile/submit");
  assert.equal(call.method, "POST");
  assert.deepEqual(serializedPayload, payload);
  assert.equal(serializedPayload.billing.phone, "+96171123456");
  assert.equal(serializedPayload.billing.country, "LB");
  assert.strictEqual(response, call);
  assert.doesNotMatch(call.path, /\/checkout\/web\/submit/);
  assert.doesNotMatch(call.path, /\/mobile\/checkout/);
  assert.doesNotMatch(call.path, /\/mobile\/mobile\//);
});

test("CyberSource preserves a Palestinian phone, LB billing country, and transient token", async () => {
  const payload = {
    checkout_session_id: "checkout-card",
    billing: {
      name: "Card Buyer",
      email: "card@example.com",
      phone: "+970599123456",
      country: "LB",
    },
    tickets_by_match: {
      "84": [{ holder_name: "Card Holder" }],
    },
    payment_method: "cybersource",
    payment: { transient_token: "transient-token" },
  };

  await checkoutService.submit(payload);
  const call = takeOnlyCall();
  const serializedPayload = JSON.parse(call.body);

  assert.equal(call.path, "/checkout/mobile/submit");
  assert.equal(call.method, "POST");
  assert.deepEqual(serializedPayload, payload);
  assert.equal(serializedPayload.billing.phone, "+970599123456");
  assert.equal(serializedPayload.billing.country, "LB");
  assert.deepEqual(serializedPayload.payment, {
    transient_token: "transient-token",
  });
});

test("checkout serialization preserves a French phone without changing billing country", async () => {
  const payload = {
    checkout_session_id: "checkout-france",
    billing: {
      name: "French Phone Buyer",
      email: "france@example.com",
      phone: "+33612345678",
      country: "LB",
    },
    tickets_by_match: {
      "126": [{ holder_name: "French Phone Holder" }],
    },
    payment_method: "blue",
  };

  await checkoutService.submit(payload);
  const call = takeOnlyCall();
  const serializedPayload = JSON.parse(call.body);

  assert.deepEqual(serializedPayload, payload);
  assert.equal(serializedPayload.billing.phone, "+33612345678");
  assert.equal(serializedPayload.billing.country, "LB");
  assert.notEqual(serializedPayload.billing.country, "FR");
});

test("capture context retains its endpoint, method, and request body", async () => {
  await checkoutService.captureContext("checkout-card", ["https://tickets.example"]);
  const call = takeOnlyCall();

  assert.equal(call.path, "/payments/cybersource/capture-context");
  assert.equal(call.method, "POST");
  assert.deepEqual(JSON.parse(call.body), {
    checkout_session_id: "checkout-card",
    target_origins: ["https://tickets.example"],
    locale: "en-us",
  });
});

test("checkout service source contains only the intended checkout route", () => {
  assert.match(serviceSource, /["']\/checkout\/mobile\/submit["']/);
  assert.doesNotMatch(serviceSource, /["']\/checkout\/web\/submit["']/);
  assert.doesNotMatch(serviceSource, /["']\/mobile\/checkout["']/);
  assert.doesNotMatch(serviceSource, /\/checkout\/mobile\/mobile\/submit/);
});
