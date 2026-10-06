import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./DeleteAccount.tsx", import.meta.url), "utf8");
const moduleUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function harness(deleteAccount = async () => {}) {
  const key = "__deleteAccountTest" + Math.random();
  const state = {
    values: [],
    cursor: 0,
    auth: { deleteAccount },
    toastMessages: [],
    toast: { showToast(message) { state.toastMessages.push(message); } },
    navigation: [],
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
    export const useTheme = () => ({ colors: { tones: { brand: { bg: "pink" } }, actionPrimary: "red" } });
    export const useI18n = () => ({ t: (k, vars) => vars ? k + JSON.stringify(vars) : k });
    export const userFacingError = (err, fallback) => (err && err.message) || fallback;
    export const router = { canGoBack: () => true, back: () => state.navigation.push("back"), replace: (to) => state.navigation.push("replace:" + to) };
    export const AccountFormShell = "AccountFormShell", PasswordField = "PasswordField", AppText = "AppText", Button = "Button", SymbolView = "SymbolView", View = "View";
    export const Fragment = Symbol("Fragment");
    export const jsx = (type, props) => ({ type, props });
    export const jsxs = jsx;
  `);
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  code = code.replace(/from "[^"]+"/g, "from " + JSON.stringify(mocks));
  const { DeleteAccount } = await import(moduleUrl(code));
  const render = () => { state.cursor = 0; return DeleteAccount(); };
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children, node.props?.footer].flat(Infinity).flatMap(nodes)];
  };
  const button = (title) => nodes(render()).find((node) => node.type === "Button" && node.props.title === title);
  const password = (value) => nodes(render()).find((node) => node.type === "PasswordField").props.onChangeText(value);
  const error = () => nodes(render()).find((node) => node.type === "AppText" && node.props.tone === "danger")?.props.children ?? null;
  return { render, button, password, error, state, cleanup: () => delete globalThis[key] };
}

test("nothing can be sent without the current password", async () => {
  const calls = [];
  const h = await harness(async (value) => calls.push(value));
  try {
    const remove = h.button("deleteAccount.submit");
    assert.equal(remove.props.disabled, true);
    assert.equal(remove.props.variant, "danger");
    remove.props.onPress();
    await flush();
    assert.deepEqual(calls, []);
  } finally {
    h.cleanup();
  }
});

test("the exact password is sent once; a second press while in flight sends nothing", async () => {
  let release;
  const calls = [];
  const h = await harness((value) => { calls.push(value); return new Promise((resolve) => { release = resolve; }); });
  try {
    h.password(" my secret ");
    h.button("deleteAccount.submit").props.onPress();
    h.button("deleteAccount.submitting").props.onPress();
    assert.deepEqual(calls, [" my secret "]);
    release();
    await flush();
  } finally {
    h.cleanup();
  }
});

test("Back and Cancel cannot leave while the request is in flight", async () => {
  let release;
  const h = await harness(() => new Promise((resolve) => { release = resolve; }));
  try {
    h.password("secret");
    h.button("deleteAccount.submit").props.onPress();
    assert.equal(h.render().props.backDisabled, true);
    assert.equal(h.button("deleteAccount.cancel").props.disabled, true);
    h.render().props.onBack();
    h.button("deleteAccount.cancel").props.onPress();
    assert.deepEqual(h.state.navigation, []);
    release();
    await flush();
  } finally {
    h.cleanup();
  }
});

test("success: the confirmation toast, then home (AuthContext has cleared the session)", async () => {
  const h = await harness(async () => {});
  try {
    h.password("secret");
    h.button("deleteAccount.submit").props.onPress();
    await flush();
    assert.deepEqual(h.state.toastMessages, [{ variant: "success", title: "deleteAccount.success.title", message: "deleteAccount.success.message" }]);
    assert.deepEqual(h.state.navigation, ["replace:/"]);
  } finally {
    h.cleanup();
  }
});

test("a failure keeps the user here with the backend message; nothing else happens", async () => {
  const h = await harness(async () => { throw new Error("The password is incorrect."); });
  try {
    h.password("wrong");
    h.button("deleteAccount.submit").props.onPress();
    await flush();
    assert.equal(h.error(), "The password is incorrect.");
    assert.deepEqual(h.state.navigation, []);
    assert.deepEqual(h.state.toastMessages, []);
    assert.equal(h.button("deleteAccount.submit").props.disabled, false, "retry is possible");
  } finally {
    h.cleanup();
  }
});

test("the production deletion authority is unchanged: DELETE /auth/account { password }, then session cleanup", async () => {
  assert.match(source, /await auth\.deleteAccount\(password\);/);
  const authService = await readFile(new URL("../services/auth.ts", import.meta.url), "utf8");
  const remove = authService.slice(authService.indexOf("async deleteAccount(password: string)"));
  assert.match(remove, /apiRequest\("\/auth\/account", \{\s*method: "DELETE",\s*body: JSON\.stringify\(\{ password \}\),/);
  const authContext = await readFile(new URL("../context/AuthContext.tsx", import.meta.url), "utf8");
  assert.match(authContext, /await authService\.deleteAccount\(password\);\s*clearSessionState\(\);/);
});
