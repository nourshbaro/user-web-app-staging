import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./BottomSheetModal.tsx", import.meta.url), "utf8");
const moduleUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");

async function harness(platformOS = "ios") {
  const key = "__bottomSheetModalTest" + Math.random();
  const state = { values: [], cursor: 0 };
  globalThis[key] = state;
  const mocks = moduleUrl(`
    const state = globalThis[${JSON.stringify(key)}];
    export const useState = (initial) => {
      const i = state.cursor++;
      if (!(i in state.values)) state.values[i] = typeof initial === "function" ? initial() : initial;
      return [state.values[i], value => { state.values[i] = typeof value === "function" ? value(state.values[i]) : value; }];
    };
    export const useRef = value => { const [ref] = useState({ current: value }); return ref; };
    export const useCallback = fn => fn;
    export const useEffect = fn => { fn(); };
    export const useMemo = fn => fn();
    export const forwardRef = render => render;
    export const useImperativeHandle = (ref, factory) => {
      const handle = factory();
      if (typeof ref === "function") ref(handle);
      else if (ref) ref.current = handle;
    };
    export const useSharedValue = (initial) => {
      const box = { value: initial };
      return { get: () => box.value, set: (v) => { box.value = typeof v === "function" ? v(box.value) : v; } };
    };
    export const useAnimatedStyle = fn => fn();
    export const withTiming = (value) => value;
    export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    export const useTheme = () => ({
      isDark: false,
      styles: { muted: {} },
      colors: { bg: "white", line: "gray", panel: "white", ink: "black", muted: "gray" },
    });
    export const useI18n = () => ({ meta: { script: "latin" } });
    export const typography = {
      displaySheet: { fontSize: 30, lineHeight: 36, fontWeight: "700" },
      displaySheetOption: { fontSize: 23, lineHeight: 28, fontWeight: "700" },
    };
    export const fontStyleFor = () => ({});
    export const scheduleOnRN = (fn, ...args) => fn(...args);
    const chainable = () => {
      const obj = {};
      ["enabled", "activeOffsetY", "failOffsetX", "onUpdate", "onEnd"].forEach((m) => { obj[m] = () => obj; });
      return obj;
    };
    export const Gesture = { Pan: chainable };
    export const GestureDetector = "GestureDetector";
    export const SymbolView = "SymbolView";
    export const KeyboardAvoidingView = "KeyboardAvoidingView";
    export const Modal = "Modal";
    export const Platform = { OS: ${JSON.stringify(platformOS)} };
    export const Pressable = "Pressable";
    export const ScrollView = "ScrollView";
    export const Text = "Text";
    export const View = "View";
    const Animated = { View: "Animated.View" };
    export default Animated;
    export const Fragment = Symbol("Fragment");
    export const jsx = (type, props) => ({ type, props });
    export const jsxs = jsx;
  `);
  let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  code = code.replace(/from "[^"]+"/g, "from " + JSON.stringify(mocks));
  const { BottomSheetModal } = await import(moduleUrl(code));
  const render = (props, ref) => { state.cursor = 0; return BottomSheetModal(props, ref); };
  const nodes = (node) => {
    if (!node || typeof node !== "object") return [];
    const rendered = typeof node.type === "function" ? node.type(node.props) : null;
    return [node, ...nodes(rendered), ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  };
  return { render, nodes, cleanup: () => delete globalThis[key] };
}

const child = { type: "Text", props: { children: "child content" } };

test("renders the header (title, handle, close button) and the body content", async () => {
  const h = await harness();
  const tree = h.nodes(h.render({ visible: true, onClose: () => {}, title: "Contact Us", children: child }));
  assert.ok(tree.find((n) => n.type === "Text" && n.props.children === "Contact Us"));
  assert.ok(tree.find((n) => n.type === "GestureDetector"));
  assert.ok(tree.includes(child), "body content is rendered");
});

test("short (non-scrollable) content is rendered directly, with no ScrollView owned by the shell", async () => {
  const h = await harness();
  const tree = h.nodes(h.render({ visible: true, onClose: () => {}, title: "Payment method", children: child }));
  assert.equal(tree.some((n) => n.type === "ScrollView"), false);
});

test("scrollable mode owns exactly one ScrollView wrapping the children", async () => {
  const h = await harness();
  const tree = h.nodes(h.render({
    visible: true,
    onClose: () => {},
    title: "Your cart",
    scrollable: true,
    contentContainerStyle: { gap: 12 },
    children: child,
  }));
  const scrollViews = tree.filter((n) => n.type === "ScrollView");
  assert.equal(scrollViews.length, 1);
  assert.deepEqual(scrollViews[0].props.contentContainerStyle, { gap: 12 });
  assert.ok(tree.includes(child), "child content still reachable inside the owned ScrollView");
});

test("keyboardAware uses iOS padding behavior on the whole overlay, and is inert on Android", async () => {
  const iosHarness = await harness("ios");
  const iosTree = iosHarness.nodes(iosHarness.render({
    visible: true, onClose: () => {}, title: "Change Password", scrollable: true, keyboardAware: true, children: child,
  }));
  const iosKav = iosTree.find((n) => n.type === "KeyboardAvoidingView");
  assert.equal(iosKav.props.behavior, "padding");

  const androidHarness = await harness("android");
  const androidTree = androidHarness.nodes(androidHarness.render({
    visible: true, onClose: () => {}, title: "Change Password", scrollable: true, keyboardAware: true, children: child,
  }));
  const androidKav = androidTree.find((n) => n.type === "KeyboardAvoidingView");
  assert.equal(androidKav.props.behavior, undefined);
});

test("informational sheets (no keyboardAware) never set a KeyboardAvoidingView behavior on either platform", async () => {
  const iosHarness = await harness("ios");
  const iosTree = iosHarness.nodes(iosHarness.render({ visible: true, onClose: () => {}, title: "Contact Us", children: child }));
  assert.equal(iosTree.find((n) => n.type === "KeyboardAvoidingView").props.behavior, undefined);
});

test("onPresented is forwarded to the native Modal's onShow", async () => {
  const h = await harness();
  const onPresented = () => {};
  const tree = h.nodes(h.render({ visible: true, onClose: () => {}, title: "Delete account", onPresented, children: child }));
  const modal = tree.find((n) => n.type === "Modal");
  assert.equal(modal.props.onShow, onPresented);
});

/** Renders a scrollable sheet, attaches fake native instances to the ScrollView's `ref` and `innerViewRef`, and returns handles to drive/inspect it. */
async function setUpScrollableSheet(h, { visible = true } = {}) {
  const sheetHandle = { current: null };
  const contentInstance = { marker: "native-content-view" };
  const scrollToCalls = [];
  const props = (nextVisible) => ({
    visible: nextVisible, onClose: () => {}, title: "Change Password", scrollable: true, children: child,
  });
  let scrollViewNode = h.nodes(h.render(props(visible), sheetHandle)).find((n) => n.type === "ScrollView");
  scrollViewNode.props.innerViewRef.current = contentInstance;
  scrollViewNode.props.ref.current = { scrollTo: (opts) => scrollToCalls.push(opts) };
  const setViewportHeight = (height) => scrollViewNode.props.onLayout({ nativeEvent: { layout: { height } } });
  const setScrollOffset = (y) => scrollViewNode.props.onScroll({ nativeEvent: { contentOffset: { y } } });
  const setVisible = (nextVisible) => {
    scrollViewNode = h.nodes(h.render(props(nextVisible), sheetHandle)).find((n) => n.type === "ScrollView");
    if (scrollViewNode) {
      scrollViewNode.props.innerViewRef.current = contentInstance;
      scrollViewNode.props.ref.current = { scrollTo: (opts) => scrollToCalls.push(opts) };
    }
  };
  const fieldAt = (top, height) => ({
    current: { measureLayout: (relativeTo, onSuccess) => onSuccess(relativeTo, top, 100, height) },
  });
  return { sheetHandle, contentInstance, scrollToCalls, getScrollViewNode: () => scrollViewNode, setViewportHeight, setScrollOffset, setVisible, fieldAt };
}

test("shared ScrollView exposes a real innerViewRef, and scrollFieldIntoView measures against that native ref — not a numeric tag", async () => {
  const h = await harness();
  try {
    const s = await setUpScrollableSheet(h);
    assert.ok(s.getScrollViewNode().props.innerViewRef, "ScrollView is given an innerViewRef");
    assert.notEqual(s.getScrollViewNode().props.innerViewRef, s.getScrollViewNode().props.ref, "innerViewRef and ref are distinct native refs");

    s.setViewportHeight(400);
    const measuredRelativeTo = [];
    const field = { current: { measureLayout: (relativeTo, onSuccess) => { measuredRelativeTo.push(relativeTo); onSuccess(0, 250, 100, 40); } } };
    s.sheetHandle.current.scrollFieldIntoView(field);

    assert.equal(measuredRelativeTo.length, 1);
    assert.notEqual(typeof measuredRelativeTo[0], "number", "must not measure against a numeric tag (getInnerViewNode)");
    assert.equal(measuredRelativeTo[0], s.contentInstance, "measures against the actual native content-view instance");
  } finally { h.cleanup(); }
});

test("a field already fully visible is left alone — no scrollTo", async () => {
  const h = await harness();
  try {
    const s = await setUpScrollableSheet(h);
    s.setViewportHeight(400);
    s.setScrollOffset(100); // visible range: [100, 500]
    s.sheetHandle.current.scrollFieldIntoView(s.fieldAt(150, 40)); // fully within [100, 500]
    assert.deepEqual(s.scrollToCalls, []);
  } finally { h.cleanup(); }
});

test("a field clipped above the viewport scrolls up just enough to preserve top context", async () => {
  const h = await harness();
  try {
    const s = await setUpScrollableSheet(h);
    s.setViewportHeight(400);
    s.getScrollViewNode().props.onContentSizeChange(0, 900);
    s.setScrollOffset(300); // visible range: [300, 700]
    s.sheetHandle.current.scrollFieldIntoView(s.fieldAt(50, 40)); // top is above the visible range
    assert.deepEqual(s.scrollToCalls, [{ y: 38, animated: true }]); // 50 - 12px margin
  } finally { h.cleanup(); }
});

test("a field clipped below the viewport scrolls down only as much as required, clamped to content", async () => {
  const h = await harness();
  try {
    const s = await setUpScrollableSheet(h);
    s.setViewportHeight(400);
    s.setScrollOffset(0); // visible range: [0, 400]
    s.getScrollViewNode().props.onContentSizeChange(0, 900);
    s.sheetHandle.current.scrollFieldIntoView(s.fieldAt(380, 60)); // bottom (440) overflows past 400
    assert.deepEqual(s.scrollToCalls, [{ y: 52, animated: true }]); // 440 - 400 + 12px margin — not scrolled to the field's top
  } finally { h.cleanup(); }
});

test("a viewport that shrinks after focus (e.g. keyboard finishing its animation) rechecks the active field", async () => {
  const h = await harness();
  try {
    const s = await setUpScrollableSheet(h);
    s.setViewportHeight(400);
    s.getScrollViewNode().props.onContentSizeChange(0, 900);
    s.sheetHandle.current.scrollFieldIntoView(s.fieldAt(350, 40)); // fully visible in [0, 400]
    assert.deepEqual(s.scrollToCalls, []);

    s.setViewportHeight(150); // the keyboard opened; the same field no longer fits
    assert.deepEqual(s.scrollToCalls, [{ y: 252, animated: true }]); // (350+40) - 150 + 12, rechecked automatically
  } finally { h.cleanup(); }
});

test("closing the sheet clears the active field so a stale field isn't rechecked after reopening", async () => {
  const h = await harness();
  try {
    const s = await setUpScrollableSheet(h);
    s.setViewportHeight(400);
    s.getScrollViewNode().props.onContentSizeChange(0, 900);
    s.setScrollOffset(300);
    s.sheetHandle.current.scrollFieldIntoView(s.fieldAt(50, 40)); // clipped above -> one scroll
    assert.equal(s.scrollToCalls.length, 1);

    s.setVisible(false); // clears the remembered active field
    s.setVisible(true);
    s.setViewportHeight(150); // would have rechecked the old field if it weren't cleared
    assert.equal(s.scrollToCalls.length, 1, "no extra scroll for a pre-close field");
  } finally { h.cleanup(); }
});

test("scrolling/bounce is disabled while content fits the viewport, and enabled once it overflows", async () => {
  const h = await harness();
  try {
    const props = { visible: true, onClose: () => {}, title: "Change Password", scrollable: true, children: child };
    let scrollViewNode = h.nodes(h.render(props)).find((n) => n.type === "ScrollView");
    assert.equal(scrollViewNode.props.scrollEnabled, false);
    assert.equal(scrollViewNode.props.bounces, false);
    assert.equal(scrollViewNode.props.alwaysBounceVertical, false);

    scrollViewNode.props.onLayout({ nativeEvent: { layout: { height: 400 } } });
    scrollViewNode.props.onContentSizeChange(0, 300);
    scrollViewNode = h.nodes(h.render(props)).find((n) => n.type === "ScrollView");
    assert.equal(scrollViewNode.props.scrollEnabled, false, "short content should not become scrollable");

    scrollViewNode.props.onContentSizeChange(0, 900);
    scrollViewNode = h.nodes(h.render(props)).find((n) => n.type === "ScrollView");
    assert.equal(scrollViewNode.props.scrollEnabled, true, "content taller than the viewport should be scrollable");
    assert.equal(scrollViewNode.props.bounces, true);
  } finally { h.cleanup(); }
});
