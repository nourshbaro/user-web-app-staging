import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "./messages/en.ts";
import { ar } from "./messages/ar.ts";
import { getAppLocale, publishAppLocale } from "./locales.ts";
import { backendHeaders } from "./backendHeaders.ts";
import { createTranslator } from "./translate.ts";
import { pluralSelectorFor } from "./pluralRules.ts";
import { createQueryCache } from "../lib/queryCache.ts";
import { getSeatAccessibility } from "../lib/seatAccessibility.ts";
import { deriveTicketSlots } from "../lib/ticketHolders.ts";
import { formatMoney, formatTime, setFormatLocale } from "../lib/format.ts";
import { getPhoneCountryName } from "../lib/phoneNumber.ts";
import { appTextBaseStyle } from "../components/foundation/appTextStyle.ts";

afterEach(() => { publishAppLocale("en"); setFormatLocale("en-US"); });
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

test("Arabic covers every English key and preserves interpolation placeholders", () => {
  for (const [key, english] of Object.entries(en)) {
    assert.ok(ar[key]?.trim(), key);
    const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(placeholders(ar[key]), placeholders(english), key);
  }
  const t = createTranslator({ messages: ar, fallback: en, selectPlural: pluralSelectorFor("ar-LB") });
  for (const key of ["auth.login.title", "cart.title", "checkout.title", "myTickets.title", "direction.restart.message"]) {
    assert.match(t.t(key), /[\u0600-\u06ff]/, key);
  }
  assert.equal(t.t("notifications.fixture", { home: "Nejmeh", away: "Ansar" }), "Nejmeh ضد Ansar");
  for (const count of [0, 1, 2, 3, 11, 100, 1.5]) {
    assert.match(t.plural("transaction.ticketCount", count), /تذ/);
  }
});

test("live language headers preserve defaults and all Fetch override shapes", () => {
  const defaults = { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer live", password: "test" };
  for (const overrides of [
    { "X-Custom": "kept", "accept-language": "fr", "content-type": "custom/type" },
    new Headers({ "X-Custom": "kept", "accept-language": "fr", "content-type": "custom/type" }),
    [["X-Custom", "kept"], ["accept-language", "fr"], ["content-type", "custom/type"]],
  ]) {
    for (const locale of ["en", "ar", "en"]) {
      publishAppLocale(locale);
      const result = new Headers(backendHeaders(defaults, overrides));
      assert.equal(result.get("Accept-Language"), locale);
      assert.equal(result.get("Authorization"), "Bearer live");
      assert.equal(result.get("password"), "test");
      assert.equal(result.get("Accept"), "application/json");
      assert.equal(result.get("Content-Type"), "custom/type");
      assert.equal(result.get("X-Custom"), "kept");
    }
  }
  assert.equal(new Headers(backendHeaders({}, { Authorization: "Bearer pinned" })).get("Authorization"), "Bearer pinned");
  assert.equal(new Headers(backendHeaders({})).has("Content-Type"), false, "multipart leaves the boundary to Fetch");
});

test("read caches do not reuse the previous language's response", async () => {
  const cache = createQueryCache();
  const policy = { freshMs: 10000, maxStaleMs: 20000 };
  let calls = 0;
  const read = () => cache.read("/content", policy, async () => { calls++; return getAppLocale(); });
  assert.equal(await read(), "en");
  publishAppLocale("ar");
  assert.equal(cache.peek("/content", policy), null);
  assert.equal(await read(), "ar");
  assert.equal(await read(), "ar");
  assert.equal(calls, 2);
});

test("web proxy forwards the request's language rather than a process-global preference", async () => {
  const source = await readFile(new URL("../app/api/[...path]+api.ts", import.meta.url), "utf8");
  const executable = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const proxy = await import(url(executable));
  const fetchBefore = globalThis.fetch;
  const passwordBefore = process.env.API_PASSWORD;
  const calls = [];
  process.env.API_PASSWORD = "test-only";
  globalThis.fetch = async (url, init) => { calls.push(init); return new Response("{}", { status: 200 }); };
  try {
    for (const locale of ["ar", "en", "fr"]) {
      await proxy.GET(new Request("http://localhost/api/matches/scheduled", { headers: { "Accept-Language": locale, Authorization: "Bearer kept" } }));
      const result = new Headers(calls.at(-1).headers);
      assert.equal(result.get("Accept-Language"), locale === "ar" ? "ar" : "en");
      assert.equal(result.get("Authorization"), "Bearer kept");
      assert.equal(result.get("Accept"), "application/json");
    }
  } finally {
    globalThis.fetch = fetchBefore;
    if (passwordBefore === undefined) delete process.env.API_PASSWORD; else process.env.API_PASSWORD = passwordBefore;
  }
});

test("Arabic seat labels translate presentation while holder keys and seat identifiers stay exact", () => {
  const items = [{ match_id: "7", lock_key: "same-lock", zone_name: "Stand A", seats: [{ id: 12, label: "B-12", row: "B", number: "12" }] }];
  const before = deriveTicketSlots(items);
  publishAppLocale("ar");
  const after = deriveTicketSlots(items);
  assert.equal(after[0].key, before[0].key);
  assert.equal(after[0].matchId, before[0].matchId);
  assert.match(after[0].label, /B-12/);
  assert.match(after[0].label, /المقعد/);
  const seat = getSeatAccessibility({ seat: { row: "B", number: "12", status: "available" }, selected: false, inCart: false });
  assert.equal(seat.disabled, false);
  assert.equal(seat.state, "available");
  assert.match(seat.label, /الصف B، المقعد 12/);
});

test("Arabic formatting isolates currency codes and preserves clock-only kickoff values", () => {
  publishAppLocale("ar"); setFormatLocale("ar-LB");
  const number = new Intl.NumberFormat("ar-LB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1250.5);
  assert.equal(formatMoney("1250.50", "USD"), `\u2066${number} USD\u2069`);
  assert.equal(formatTime("20:15"), new Intl.DateTimeFormat("ar-LB", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, 20, 15)));
  assert.equal(formatMoney(null), ar["format.priceUnavailable"]);
  assert.equal(getPhoneCountryName("LB"), "لبنان");
  const style = appTextBaseStyle({ token: { fontSize: 16 }, lineHeight: 24, fontStyle: { fontWeight: "400" }, color: "black", align: "start", latin: false });
  assert.equal(style.writingDirection, "rtl");
});

test("native card bridge errors remain executable without app-only translation functions inside the WebView", async () => {
  const source = await readFile(new URL("../components/CybersourceUnifiedCheckout.native.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("card.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["jsStringLiteral", "buildCheckoutHtml"].includes(node.name?.text)).map(node => node.getText(ast)).join("\n");
  const code = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ config: { cybersourceUnifiedCheckoutUrl: "https://payments.example.test/sdk.js" } });
  vm.runInContext(code, context);
  const html = vm.runInContext('buildCheckoutHtml("capture-context")', context);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const messages = [];
  const bridge = vm.createContext({ window: { addEventListener() {}, ReactNativeWebView: { postMessage: text => messages.push(JSON.parse(text)) } } });
  vm.runInContext(script, bridge);
  vm.runInContext('fail(new Error("provider reason"))', bridge);
  vm.runInContext("fail({})", bridge);
  // The provider's reason passes through; without one the native wrapper uses catalog copy.
  assert.deepEqual(messages, [{ type: "error", message: "provider reason" }, { type: "error" }]);
  assert.match(source, /message\.message \?\? translate\("payment\.form\.generic"\)/);
});

test("the real web physical-layout wrapper pins LTR inside an RTL React Native Web tree", async () => {
  const require = createRequire(import.meta.url);
  const key = `__physicalLayout_${Math.random()}`;
  globalThis[key] = require("react-native-web").View;
  const mocks = url(`
    export const View = globalThis[${JSON.stringify(key)}];
    export const Platform = { OS: "web" };
    export const Text = View, SymbolView = View;
    export const PHYSICAL_LAYOUT_STYLE = { direction: "ltr" };
    export const useI18n = () => ({ isRTL: true });
    export const directionalChevron = () => ({}), navigationBackGlyph = () => ({}), headerPlatform = () => "ios";
  `);
  try {
    const source = await readFile(new URL("../components/foundation/direction.tsx", import.meta.url), "utf8");
    const executable = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
      .replace(/from "([^"]+)"/g, (_, specifier) => `from ${JSON.stringify(specifier === "react/jsx-runtime" ? pathToFileURL(require.resolve("react/jsx-runtime")).href : mocks)}`);
    const { PhysicalLayout } = await import(url(executable));
    const View = globalThis[key];
    const html = renderToStaticMarkup(React.createElement(View, { dir: "rtl" }, React.createElement(PhysicalLayout, null, React.createElement(View, null))));
    assert.match(html, /dir="rtl"[\s\S]*dir="ltr"/);
  } finally { delete globalThis[key]; }
});

/** Execute the real provider lifecycle with controlled storage/native APIs. */
async function providerHarness({ stored = null, platform = "web", failSet = false, getGate } = {}) {
  const key = `__locale_${Math.random()}`;
  const state = { slots: [], cursor: 0, effects: [], stored, failSet, reloads: 0, directions: [], getGate };
  globalThis[key] = state;
  const mocks = url(`
    const s = globalThis[${JSON.stringify(key)}];
    export const useState = initial => {
      const i = s.cursor++;
      if (!(i in s.slots)) s.slots[i] = typeof initial === "function" ? initial() : initial;
      return [s.slots[i], value => { s.slots[i] = typeof value === "function" ? value(s.slots[i]) : value; }];
    };
    export const useRef = initial => useState({ current: initial })[0];
    export const useCallback = fn => fn;
    export const useMemo = fn => fn();
    export const useEffect = fn => { const [ran, set] = useState(false); if (!ran) { set(true); s.effects.push(fn); } };
    export const createContext = () => ({ Provider: "Provider" });
    export const useContext = () => null;
    export const jsx = (type, props) => ({ type, props });
    export const jsxs = jsx;
    export const storage = {
      get: async () => { await s.getGate; return s.stored; },
      set: async (key, value) => { if(s.failSet) throw Error("storage unavailable"); s.stored = value; },
      remove: async () => {},
    };
    export const Platform = { OS: ${JSON.stringify(platform)} };
    export const I18nManager = { isRTL: false, allowRTL: v => s.directions.push(v), forceRTL: () => {} };
    export const reloadAppAsync = async () => { s.reloads++; };
    export const hideAsync = async () => {};
    export const darkColors = {}, lightColors = {};
    export const useColorScheme = () => "light";
    export const View = "View", Text = "Text", Pressable = "Pressable";
  `);
  const source = await readFile(new URL("./I18nProvider.tsx", import.meta.url), "utf8");
  const executable = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace(/from "([^"]+)"/g, (_, specifier) => {
      if (specifier.startsWith("@/i18n/")) return `from ${JSON.stringify(new URL(specifier.replace("@/i18n/", "./") + ".ts", import.meta.url).href)}`;
      if (specifier === "@/lib/format") return `from ${JSON.stringify(new URL("../lib/format.ts", import.meta.url).href)}`;
      return `from ${JSON.stringify(mocks)}`;
    });
  const { I18nProvider } = await import(url(executable));
  return {
    state,
    render() { state.cursor = 0; return I18nProvider({ children: "same-app-tree" }); },
    async effects() { state.effects.splice(0).forEach(fn => fn()); for (let i = 0; i < 20; i++) await Promise.resolve(); },
    cleanup() { delete globalThis[key]; },
  };
}

test("provider restores Arabic before showing content, persists changes, and reports storage failures", async () => {
  let release;
  const h = await providerHarness({ stored: "ar", getGate: new Promise(resolve => { release = resolve; }) });
  try {
    assert.equal(h.render(), null, "no English content while restoring");
    await h.effects();
    assert.equal(h.render(), null);
    release();
    await h.effects();
    let tree = h.render();
    assert.equal(tree.props.value.locale, "ar");
    assert.equal(tree.props.children.props.children, "same-app-tree");
    assert.equal(tree.props.children.props.dir, "rtl");
    await tree.props.value.setLanguage("en");
    tree = h.render();
    assert.equal(h.state.stored, "en");
    assert.equal(tree.props.value.locale, "en");
    assert.equal(tree.props.children.props.dir, "ltr");
    assert.equal(getAppLocale(), "en");
    h.state.failSet = true;
    await assert.rejects(tree.props.value.setLanguage("ar"), /storage unavailable/);
    assert.equal(h.render().props.value.locale, "en");
    assert.equal(getAppLocale(), "en");
  } finally { h.cleanup(); }
});

test("native language changes preserve the mounted app and defer direction reload to the user", async () => {
  const h = await providerHarness({ platform: "android", stored: "invalid" });
  try {
    h.render(); await h.effects();
    const tree = h.render();
    assert.equal(tree.props.value.locale, "en");
    await tree.props.value.setLanguage("ar");
    const changed = h.render();
    assert.equal(changed.props.children, tree.props.children);
    assert.equal(changed.props.value.locale, "ar");
    assert.equal(changed.props.value.isRTL, false, "reports the active native layout");
    assert.equal(changed.props.value.restartRequired, true);
    assert.equal(h.state.reloads, 0, "never reloads an active payment automatically");
    assert.ok(h.state.directions.includes(true));
    assert.equal(getAppLocale(), "ar");
  } finally { h.cleanup(); }
});
