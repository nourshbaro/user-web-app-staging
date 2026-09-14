import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./ChangePassword.tsx", import.meta.url), "utf8");
const moduleUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");

async function harness(changePassword = async () => {}) {
  const key = "__passwordTest" + Math.random();
  const state = {
    values: [],
    cursor: 0,
    auth: { changePassword },
    toastMessages: [],
    toast: { showToast(message) { state.toastMessages.push(message); } },
  };
  globalThis[key] = state;
  const mocks = moduleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const useState = (initial) => {
      const i = state.cursor++;
      if (!(i in state.values)) state.values[i] = initial;
      return [state.values[i], value => { state.values[i] = typeof value === "function" ? value(state.values[i]) : value; }];
    };
    export const useRef = value => { const [ref] = useState({ current: value }); return ref; };
    export const useAuth = () => state.auth;
    export const useToast = () => state.toast;
    export const useTheme = () => ({ styles: { muted: {} }, colors: { danger: "red", line: "gray", panelSoft: "white", primary: "red", ink: "black", muted: "gray" } });
    export class ApiError extends Error {}
    export const Text = "Text", View = "View", Button = "Button", TextInput = "TextInput", Pressable = "Pressable", SymbolView = "SymbolView", ScrollView = "ScrollView", KeyboardAvoidingView = "KeyboardAvoidingView", BottomSheetModal = "BottomSheetModal";
    export const Platform = { OS: "ios" };
    export const Fragment = Symbol("Fragment");
    export const StyleSheet = { create: value => value, hairlineWidth: 1 };
    export const jsx = (type, props) => ({ type, props });
    export const jsxs = jsx;
  `);
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  code = code.replace(/from "[^"]+"/g, "from " + JSON.stringify(mocks));
  const { ChangePassword } = await import(moduleUrl(code));
  const render = () => { state.cursor = 0; return ChangePassword(); };
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    const rendered = typeof node.type === "function" ? node.type(node.props) : null;
    return [node, ...nodes(rendered), ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  };
  const find = (type, title) => nodes(render()).find(node => node.type === type && (!title || node.props.title === title));
  const press = title => {
    const control = find("Button", title) ?? nodes(render()).find(node => node.type === "Pressable" && node.props.accessibilityLabel === title);
    assert.ok(control, title);
    control.props.onPress();
  };
  const enter = (label, value) => nodes(render()).find(node => node.type === "TextInput" && node.props.accessibilityLabel === label).props.onChangeText(value);
  return { render, find, press, enter, nodes, state, cleanup: () => delete globalThis[key] };
}

test("password modal uses the shared sheet, requires each field, and rejects mismatched confirmation", async () => {
  let calls = 0;
  const h = await harness(async () => { calls++; });
  try {
    h.press("Change Password");
    const modal = h.find("BottomSheetModal");
    assert.equal(modal.props.visible, true);
    assert.equal(modal.props.title, "Change Password");
    assert.equal(modal.props.dismissible, true);
    assert.equal(h.find("TextInput").props.accessibilityLabel, "Current Password");
    assert.ok(h.nodes(h.render()).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "New Password"));
    assert.ok(h.nodes(h.render()).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Confirm New Password"));
    h.press("Update Password");
    assert.equal(calls, 0);
    h.enter("Current Password", "old password"); h.press("Update Password");
    assert.equal(calls, 0);
    h.enter("New Password", "new password"); h.press("Update Password");
    assert.equal(calls, 0);
    h.enter("Confirm New Password", "NEW password"); h.press("Update Password");
    assert.equal(calls, 0);
    assert.equal(h.find("TextInput").props.secureTextEntry, true);
    h.find("BottomSheetModal").props.onClose();
    assert.equal(h.find("BottomSheetModal").props.visible, false);
    h.press("Change Password");
    assert.equal(h.find("TextInput").props.value, "");
  } finally { h.cleanup(); }
});

test("keyboard and button submission share a synchronous guard and send exact password values", async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const calls = [];
  const h = await harness((...args) => { calls.push(args); return pending; });
  try {
    h.press("Change Password"); h.enter("Current Password", " old ");
    h.enter("New Password", " new "); h.enter("Confirm New Password", " new ");
    const input = h.nodes(h.render()).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Confirm New Password");
    input.props.onSubmitEditing(); input.props.onSubmitEditing();
    assert.deepEqual(calls, [[" old ", " new ", " new "]]);
    assert.equal(h.find("TextInput").props.editable, false);
    assert.equal(h.find("BottomSheetModal").props.dismissible, false);
    complete("Password changed. Please log in again."); await pending; await Promise.resolve();
    assert.deepEqual(h.state.toastMessages.at(-1), {
      variant: "success",
      title: "Password changed",
      message: "Password changed. Please log in again.",
    });
    assert.equal(h.find("BottomSheetModal").props.visible, false);
  } finally { h.cleanup(); }
});
