import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./AccountDeletionModal.tsx", import.meta.url), "utf8");
const moduleUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");

async function harness(deleteAccount = async () => {}) {
  const key = "__deleteAccountTest" + Math.random();
  const state = {
    values: [],
    cursor: 0,
    auth: { deleteAccount },
    toastMessages: [],
    toast: { showToast(message) { state.toastMessages.push(message); } },
    replaced: [],
  };
  globalThis[key] = state;
  // AccountDeletionModal.tsx schedules autofocus via requestAnimationFrame,
  // which isn't a Node global — shim it deterministically for this harness.
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  const mocks = moduleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const useState = (initial) => {
      const i = state.cursor++;
      if (!(i in state.values)) state.values[i] = initial;
      return [state.values[i], value => { state.values[i] = typeof value === "function" ? value(state.values[i]) : value; }];
    };
    export const useRef = value => { const [ref] = useState({ current: value }); return ref; };
    export const useCallback = fn => fn;
    export const forwardRef = render => render;
    export const useAuth = () => state.auth;
    export const useToast = () => state.toast;
    export const useTheme = () => ({ styles: { muted: {}, label: {} }, colors: { danger: "red", line: "gray", panelSoft: "white", primary: "red", ink: "black", muted: "gray" } });
    export const router = { replace: (to) => state.replaced.push(to) };
    export const userFacingError = (err, fallback) => (err && err.message) || fallback;
    export const Text = "Text", TextInput = "TextInput", Button = "Button", View = "View", BottomSheetModal = "BottomSheetModal";
    export const Input = (props) => ({ type: "TextInput", props: { ...props, accessibilityLabel: props.label } });
    export const Fragment = Symbol("Fragment");
    export const jsx = (type, props) => ({ type, props });
    export const jsxs = jsx;
  `);
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  code = code.replace(/from "[^"]+"/g, "from " + JSON.stringify(mocks));
  const { AccountDeletionModal } = await import(moduleUrl(code));
  const render = (props) => { state.cursor = 0; return AccountDeletionModal(props); };
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    const rendered = typeof node.type === "function" ? node.type(node.props) : null;
    return [node, ...nodes(rendered), ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  };
  const find = (props, type) => nodes(render(props)).find(node => node.type === type);
  // Same technique as ChangePassword.test.mjs: the mocked `forwardRef`/`jsx`
  // don't strip `ref` out of props, so the ref object attached to `<Input
  // ref={passwordInputRef} .../>` survives at `node.props.ref` with the same
  // identity the component's own `useRef()` holds.
  const attachFocusSpy = (props) => {
    const calls = [];
    const input = find(props, "TextInput");
    assert.ok(input, "password TextInput");
    input.props.ref.current = { focus: () => calls.push("Password") };
    return calls;
  };
  return {
    render, find, nodes, state, attachFocusSpy,
    cleanup: () => { delete globalThis[key]; globalThis.requestAnimationFrame = previousRaf; },
  };
}

test("uses the shared sheet's owned keyboard-aware scrolling, not its own ScrollView/KeyboardAvoidingView", async () => {
  const h = await harness();
  try {
    const props = { visible: true, onClose: () => {} };
    const modal = h.find(props, "BottomSheetModal");
    assert.equal(modal.props.scrollable, true);
    assert.equal(modal.props.keyboardAware, true);
    assert.equal(h.nodes(h.render(props)).some(node => node.type === "ScrollView"), false);
    assert.equal(h.nodes(h.render(props)).some(node => node.type === "KeyboardAvoidingView"), false);
  } finally { h.cleanup(); }
});

test("the password field autofocuses only once the sheet reports it has presented", async () => {
  const h = await harness();
  try {
    const props = { visible: true, onClose: () => {} };
    const calls = h.attachFocusSpy(props);
    assert.equal(calls.length, 0);
    h.find(props, "BottomSheetModal").props.onPresented();
    assert.deepEqual(calls, ["Password"]);
  } finally { h.cleanup(); }
});

test("focusing the password field reveals the instruction text + field group, not just the input", async () => {
  const h = await harness();
  try {
    const props = { visible: true, onClose: () => {} };
    const modal = h.find(props, "BottomSheetModal");
    const scrollCalls = [];
    modal.props.ref.current = { scrollFieldIntoView: (fieldRef) => scrollCalls.push(fieldRef) };

    const input = h.find(props, "TextInput");
    input.props.onFocus();
    assert.equal(scrollCalls.length, 1);
  } finally { h.cleanup(); }
});

test("deletion remains blocked without a password and dismissal is disabled while submitting", async () => {
  let resolveDelete;
  const pending = new Promise((resolve) => { resolveDelete = resolve; });
  const h = await harness(() => pending);
  try {
    const props = { visible: true, onClose: () => {} };
    const deleteButton = h.nodes(h.render(props)).find(node => node.type === "Button" && node.props.title === "Delete permanently");
    assert.equal(deleteButton.props.disabled, true);

    const input = h.find(props, "TextInput");
    input.props.onChangeText("secret");
    const deleteButtonAfterEntry = h.nodes(h.render(props)).find(node => node.type === "Button" && node.props.title === "Delete permanently");
    assert.equal(deleteButtonAfterEntry.props.disabled, false);

    deleteButtonAfterEntry.props.onPress();
    const modalWhileSubmitting = h.find(props, "BottomSheetModal");
    assert.equal(modalWhileSubmitting.props.dismissible, false);

    resolveDelete();
    await pending;
    await Promise.resolve();
    assert.deepEqual(h.state.toastMessages.at(-1), {
      variant: "success",
      title: "Account deleted",
      message: "Your account has been permanently deleted.",
    });
    assert.deepEqual(h.state.replaced, ["/"]);
  } finally { h.cleanup(); }
});
