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
}).outputText.replace('from "@/services/api"', `from ${JSON.stringify(apiMock)}`);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`;
const { userFacingError, backendProvidedError, backendResponseMessage } = await import(moduleUrl);
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
