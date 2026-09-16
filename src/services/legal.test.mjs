import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const serviceUrl = new URL("./legal.ts", import.meta.url);
const serviceSource = await readFile(serviceUrl, "utf8");
const callsKey = `__legalServiceCalls_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const responseKey = `__legalServiceResponse_${Date.now()}_${Math.random().toString(36).slice(2)}`;
globalThis[callsKey] = [];
globalThis[responseKey] = { value: "" };

const apiMockSource = `
export async function apiRequest(path) {
  globalThis[${JSON.stringify(callsKey)}].push(path);
  const response = globalThis[${JSON.stringify(responseKey)}].value;
  if (response instanceof Error) throw response;
  return response;
}
export function unwrapData(payload) {
  return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
}
`;
const apiMockUrl = `data:text/javascript;base64,${Buffer.from(apiMockSource).toString("base64")}`;
const executableSource = ts.transpileModule(serviceSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('from "@/services/api"', `from ${JSON.stringify(apiMockUrl)}`);
const serviceModuleUrl = `data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}`;
const { legalService } = await import(serviceModuleUrl);

function takeOnlyCall() {
  assert.equal(globalThis[callsKey].length, 1);
  return globalThis[callsKey].shift();
}

test.after(() => {
  delete globalThis[callsKey];
  delete globalThis[responseKey];
});

test("privacyPolicy calls /legal/privacy-policy and returns its content", async () => {
  globalThis[responseKey].value = { content: "Privacy body." };
  const content = await legalService.privacyPolicy();
  assert.equal(takeOnlyCall(), "/legal/privacy-policy");
  assert.equal(content, "Privacy body.");
});

test("termsOfUse calls /legal/terms-of-use, not the privacy endpoint", async () => {
  globalThis[responseKey].value = { content: "Terms body." };
  const content = await legalService.termsOfUse();
  assert.equal(takeOnlyCall(), "/legal/terms-of-use");
  assert.equal(content, "Terms body.");
});

test("termsOfUse reads a terms-shaped content key just like privacy reads its own", async () => {
  globalThis[responseKey].value = { data: { terms_of_use: "Terms via snake_case key." } };
  assert.equal(await legalService.termsOfUse(), "Terms via snake_case key.");

  globalThis[responseKey].value = { data: { termsOfUse: "Terms via camelCase key." } };
  assert.equal(await legalService.termsOfUse(), "Terms via camelCase key.");
});

test("termsOfUse throws a terms-specific message when no usable content is returned", async () => {
  globalThis[responseKey].value = { unrelated: "field" };
  await assert.rejects(
    () => legalService.termsOfUse(),
    (error) => error instanceof Error && error.message === "The terms of use are currently unavailable.",
  );
});

test("privacyPolicy still throws its own message on missing content, independent of terms", async () => {
  globalThis[responseKey].value = { unrelated: "field" };
  await assert.rejects(
    () => legalService.privacyPolicy(),
    (error) => error instanceof Error && error.message === "The privacy policy is currently unavailable.",
  );
});

test("termsOfUse normalizes HTML the same way privacy content is normalized", async () => {
  globalThis[responseKey].value = { content: "<p>Line one</p><br><li>Item</li>" };
  const content = await legalService.termsOfUse();
  assert.equal(content, "Line one\n\n• Item");
});
