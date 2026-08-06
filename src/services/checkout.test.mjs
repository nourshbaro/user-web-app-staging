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

test("Blue checkout uses the mobile submit endpoint without changing its payload or response", async () => {
  const payload = {
    checkout_session_id: "checkout-blue",
    billing: {
      name: "Blue Buyer",
      email: "blue@example.com",
      phone: "+961 70 123 456",
      country: "LB",
    },
    tickets_by_match: {
      "42": [{ holder_name: "Blue Holder" }],
    },
    payment_method: "blue",
  };

  const response = await checkoutService.submit(payload);
  const call = takeOnlyCall();

  assert.equal(call.path, "/checkout/mobile/submit");
  assert.equal(call.method, "POST");
  assert.deepEqual(JSON.parse(call.body), payload);
  assert.strictEqual(response, call);
  assert.doesNotMatch(call.path, /\/checkout\/web\/submit/);
  assert.doesNotMatch(call.path, /\/mobile\/checkout/);
  assert.doesNotMatch(call.path, /\/mobile\/mobile\//);
});

test("CyberSource checkout preserves the transient token on the shared mobile endpoint", async () => {
  const payload = {
    checkout_session_id: "checkout-card",
    billing: {
      name: "Card Buyer",
      email: "card@example.com",
      phone: "+961 71 234 567",
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

  assert.equal(call.path, "/checkout/mobile/submit");
  assert.equal(call.method, "POST");
  assert.deepEqual(JSON.parse(call.body), payload);
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
