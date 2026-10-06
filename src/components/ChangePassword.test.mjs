import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./ChangePassword.tsx", import.meta.url), "utf8");
const moduleUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");

/** Renders the screen with mocked hooks; `i18n.t` returns the key so assertions name the exact message. */
async function harness(changePassword = async () => {}) {
  const key = "__passwordTest" + Math.random();
  const state = {
    values: [],
    cursor: 0,
    auth: { changePassword },
    toastMessages: [],
    toast: { showToast(message) { state.toastMessages.push(message); } },
    navigation: [],
    canGoBack: true,
  };
  globalThis[key] = state;
  const mocks = moduleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const useState = (initial) => {
      const i = state.cursor++;
      if (!(i in state.values)) state.values[i] = typeof initial === "function" ? initial() : initial;
      return [state.values[i], value => { state.values[i] = typeof value === "function" ? value(state.values[i]) : value; }];
    };
    export const useRef = value => { const [ref] = useState({ current: value }); return ref; };
    export const useAuth = () => state.auth;
    export const useToast = () => state.toast;
    export const useI18n = () => ({ t: (k, vars) => vars ? k + JSON.stringify(vars) : k });
    export const router = { canGoBack: () => state.canGoBack, back: () => state.navigation.push("back"), replace: (to) => state.navigation.push("replace:" + to) };
    export class ApiError extends Error { constructor(message, status, body) { super(message); this.status = status; this.body = body; } }
    state.ApiError = ApiError;
    export const AccountFormShell = "AccountFormShell", PasswordField = "PasswordField", AppText = "AppText", Button = "Button", TextInput = "TextInput";
    export const Fragment = Symbol("Fragment");
    export const jsx = (type, props) => ({ type, props });
    export const jsxs = jsx;
  `);
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  code = code.replace(/from "[^"]+"/g, "from " + JSON.stringify(mocks));
  const mod = await import(moduleUrl(code));
  const render = () => { state.cursor = 0; return mod.ChangePassword(); };
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children, node.props?.footer].flat(Infinity).flatMap(nodes)];
  };
  const field = (label) => nodes(render()).find((node) => node.type === "PasswordField" && node.props.label === label);
  const enter = (label, value) => field(label).props.onChangeText(value);
  const button = () => nodes(render()).find((node) => node.type === "Button");
  const shell = () => render();
  const error = () => nodes(render()).find((node) => node.type === "AppText" && node.props.tone === "danger")?.props.children ?? null;
  const fillAll = (current = "old-pass", next = "new-pass-123", confirm = next) => {
    enter("changePassword.current", current);
    enter("changePassword.new", next);
    enter("changePassword.confirm", confirm);
  };
  return { mod, render, field, enter, button, shell, error, fillAll, state, cleanup: () => delete globalThis[key] };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("each field is required, in order, and a mismatched confirmation is rejected; nothing is sent", async () => {
  const calls = [];
  const h = await harness(async (...args) => calls.push(args));
  try {
    h.button().props.onPress();
    assert.equal(h.error(), "changePassword.error.current");
    h.enter("changePassword.current", "old");
    h.button().props.onPress();
    assert.equal(h.error(), "changePassword.error.new");
    h.enter("changePassword.new", "new-one");
    h.button().props.onPress();
    assert.equal(h.error(), "changePassword.error.confirm");
    h.enter("changePassword.confirm", "different");
    h.button().props.onPress();
    assert.equal(h.error(), "changePassword.error.mismatch");
    await flush();
    assert.equal(calls.length, 0);
  } finally {
    h.cleanup();
  }
});

test("keyboard and button submission share a synchronous guard and send exact password values", async () => {
  let release;
  const calls = [];
  const h = await harness((...args) => { calls.push(args); return new Promise((resolve) => { release = resolve; }); });
  try {
    h.fillAll("  old pass ", "New-Pass-123", "New-Pass-123");
    h.button().props.onPress();
    h.field("changePassword.confirm").props.onSubmitEditing(); // Return on the last field
    h.button().props.onPress();
    assert.deepEqual(calls, [["  old pass ", "New-Pass-123", "New-Pass-123"]], "sent once, values untouched");
    assert.equal(h.button().props.disabled, true);
    assert.equal(h.shell().props.backDisabled, true, "back is disabled while the change is in flight");
    for (const label of ["changePassword.current", "changePassword.new", "changePassword.confirm"]) {
      assert.equal(h.field(label).props.editable, false, label);
    }
    release("Password changed. Please log in again.");
    await flush();
    assert.deepEqual(h.state.toastMessages, [{ variant: "success", title: "changePassword.success.title", message: "Password changed. Please log in again." }]);
  } finally {
    h.cleanup();
  }
});

test("Back cannot leave while the change is in flight", async () => {
  let release;
  const h = await harness(() => new Promise((resolve) => { release = resolve; }));
  try {
    h.fillAll();
    h.button().props.onPress();
    h.shell().props.onBack();
    assert.deepEqual(h.state.navigation, []);
    release("");
    await flush();
    h.shell().props.onBack();
    assert.deepEqual(h.state.navigation, ["back"]);
  } finally {
    h.cleanup();
  }
});

test("backend errors surface the backend's message (never transport text); others fall back", async () => {
  const cases = [
    [{ message: "The current password is incorrect." }, "The current password is incorrect."],
    [{ errors: { password: ["The password must be at least 8 characters."] } }, "The password must be at least 8 characters."],
    [{ error: "Too many attempts." }, "Too many attempts."],
    [{}, "changePassword.error.generic"],
  ];
  for (const [body, expected] of cases) {
    let h;
    h = await harness(async () => { throw new h.state.ApiError("Request failed with 422", 422, body); });
    try {
      h.fillAll();
      h.button().props.onPress();
      await flush();
      assert.equal(h.error(), expected, JSON.stringify(body));
      assert.equal(h.state.toastMessages.length, 0);
    } finally {
      h.cleanup();
    }
  }
  const h = await harness(async () => { throw new Error("offline"); });
  try {
    h.fillAll();
    h.button().props.onPress();
    await flush();
    assert.equal(h.error(), "changePassword.error.generic");
  } finally {
    h.cleanup();
  }
});

test("success leaves session handling to AuthContext (cleared, sign in again)", async () => {
  assert.match(source, /await auth\.changePassword\(currentPassword, password, confirmation\)/);
  const authContext = await readFile(new URL("../context/AuthContext.tsx", import.meta.url), "utf8");
  const change = authContext.slice(authContext.indexOf("const changePassword = useCallback"));
  assert.match(change, /authService\.changePassword\(/);
  assert.match(change, /clearSessionState\(\);/);
  assert.match(change, /router\.push\("\/auth"\)/);
});

test("return key progresses focus Current -> New -> Confirm", async () => {
  const h = await harness();
  try {
    const focused = [];
    h.field("changePassword.new").props.ref.current = { focus: () => focused.push("new") };
    h.field("changePassword.confirm").props.ref.current = { focus: () => focused.push("confirm") };
    h.field("changePassword.current").props.onSubmitEditing();
    h.field("changePassword.new").props.onSubmitEditing();
    assert.deepEqual(focused, ["new", "confirm"]);
  } finally {
    h.cleanup();
  }
});
