import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./userFacingError.ts", import.meta.url), "utf8");
const apiMock = `data:text/javascript;base64,${Buffer.from(`
  export class ApiError extends Error {
    constructor(message, status, body) { super(message); this.status = status; this.body = body; }
  }
  export class ApiTransportError extends Error {}
`).toString("base64")}`;
const executable = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from "(\.\.\/i18n\/[^"\n]+\.ts)"/g, (_, path) => `from ${JSON.stringify(new URL(path, import.meta.url).href)}`).replace('from "@/services/api"', `from ${JSON.stringify(apiMock)}`);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`;
const { userFacingError, backendProvidedError, backendResponseMessage, failureReason, reasonWithGuidance } = await import(moduleUrl);
const { ApiError, ApiTransportError } = await import(apiMock);

test("userFacingError surfaces the backend message and only falls back when absent", () => {
  assert.equal(
    userFacingError(new ApiError("request failed", 400, { message: "Email already registered" }), "fallback"),
    "Email already registered",
  );
  assert.equal(
    userFacingError(new ApiError("request failed", 422, { errors: { email: ["The email field is required."] } }), "fallback"),
    "The email field is required.",
  );
  assert.equal(
    userFacingError(new ApiError("Request failed with 500", 500, null), "fallback"),
    "fallback",
  );
  assert.equal(
    userFacingError(new ApiTransportError("Unable to reach the server."), "fallback"),
    "Unable to reach the server.",
  );
  assert.equal(userFacingError(new Error("internal detail"), "fallback"), "fallback");
});

test("failureReason is the backend's or the transport's own reason, never raw exception text", () => {
  assert.equal(
    failureReason(new ApiError("request failed", 422, { message: "The billing.email field is required." })),
    "The billing.email field is required.",
  );
  assert.equal(failureReason(new ApiTransportError("Request timed out.")), "Request timed out.");
  assert.equal(failureReason(new ApiError("Request failed with 500", 500, null)), null);
  assert.equal(failureReason(new Error("internal detail")), null);
  assert.equal(failureReason(undefined), null);
});

test("reasonWithGuidance keeps the guidance after the reason, or alone without one", () => {
  assert.equal(
    reasonWithGuidance(new ApiError("request failed", 500, { message: "Server Error" }), "Check My Tickets."),
    "Server Error Check My Tickets.",
  );
  assert.equal(reasonWithGuidance(new Error("internal detail"), "Check My Tickets."), "Check My Tickets.");
});

test("backend-provided errors prefer message, error, then validation text", () => {
  assert.equal(
    backendProvidedError(new ApiError("request failed", 400, { message: "Payment unavailable" }), "fallback"),
    "Payment unavailable",
  );
  assert.equal(
    backendProvidedError(new ApiError("request failed", 400, { error: "Order not found" }), "fallback"),
    "Order not found",
  );
  assert.equal(
    backendProvidedError(new ApiError("request failed", 422, { errors: { order: ["Order is invalid"] } }), "fallback"),
    "Order is invalid",
  );
});

test("a backend error without a message never shows the transport text", () => {
  assert.equal(backendProvidedError(new ApiError("Request failed with 500", 500, null), "fallback"), "fallback");
  assert.equal(backendProvidedError(new ApiError("Request failed with 502", 502, { message: "  " }), "fallback"), "fallback");
  assert.equal(userFacingError(new ApiError("Request failed with 500", 500, {}), "fallback"), "fallback");
});

test("PDF response extraction ignores blanks and supports validation text", () => {
  assert.equal(
    backendResponseMessage({ message: "", error: "PDF authorization failed" }),
    "PDF authorization failed",
  );
  assert.equal(
    backendResponseMessage({ errors: { order: ["PDF order is invalid"] } }),
    "PDF order is invalid",
  );
});

test("transport errors retain their stable message and unknown errors use fallback", () => {
  assert.equal(
    backendProvidedError(new ApiTransportError("Unable to reach the server."), "fallback"),
    "Unable to reach the server.",
  );
  assert.equal(backendProvidedError(new Error("internal detail"), "fallback"), "fallback");
});
