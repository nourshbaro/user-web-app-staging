import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { en } from "./messages/en.ts";
import { ar } from "./messages/ar.ts";
import { createTranslator } from "./translate.ts";
import { pluralSelectorFor } from "./pluralRules.ts";
import { publishAppLocale } from "./locales.ts";
import { translate } from "./runtime.ts";
import { PHONE_COUNTRIES, phoneCountryOptions } from "../lib/phoneNumber.ts";

afterEach(() => publishAppLocale("en"));
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const arabic = createTranslator({ messages: ar, fallback: en, selectPlural: pluralSelectorFor("ar-LB") });
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" },
}).outputText;
const parse = (source) => ts.createSourceFile("screen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("signed-out Profile renders exactly one language selector", async () => {
  const source = await read("../app/profile.tsx");
  const ast = parse(source);
  let selectors = 0;
  const visit = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === "LanguageSelector") selectors++;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(selectors, 1, "no second selector elsewhere in the signed-out tree");
  const menu = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PublicMenu");
  assert.ok(menu);
  const tree = vm.runInNewContext(compile(menu.getText(ast)) + "\nPublicMenu()", {
    h: (type, props, ...children) => ({ type, props, children }),
    useI18n: () => arabic, Card: "Card", View: "View", AppText: "AppText",
    LanguageSelector: "LanguageSelector", MenuRow: "MenuRow",
  });
  const nodes = (node) => [node, ...(node?.children ?? []).flat(Infinity).flatMap(nodes)];
  assert.equal(nodes(tree).filter(node => node?.type === "LanguageSelector").length, 1);
});

test("country names sort in Arabic while English order and country membership stay unchanged", () => {
  const english = phoneCountryOptions("en");
  const localized = phoneCountryOptions("ar");
  assert.deepEqual(english.map(item => item.phoneCountry), PHONE_COUNTRIES.map(item => item.phoneCountry));
  assert.deepEqual(localized.map(item => item.phoneCountry).sort(), english.map(item => item.phoneCountry).sort());
  assert.notDeepEqual(localized.map(item => item.phoneCountry), english.map(item => item.phoneCountry));
  const compare = new Intl.Collator("ar").compare;
  for (let i = 1; i < localized.length; i++) assert.ok(compare(localized[i - 1].name, localized[i].name) <= 0);
  assert.ok(localized.findIndex(item => item.phoneCountry === "TN") < localized.findIndex(item => item.phoneCountry === "LB"));
  assert.ok(english.findIndex(item => item.phoneCountry === "LB") < english.findIndex(item => item.phoneCountry === "TN"));
  assert.ok(!localized.some(item => item.phoneCountry === "IL"));
});

test("both country name languages, ISO codes and calling codes work in either UI language", () => {
  for (const locale of ["en", "ar"]) {
    for (const query of ["لبنان", "lebanon", "LEBANON", "lb", "LB", "+961", "961", "  Lebanon  "]) {
      const result = phoneCountryOptions(locale, query);
      assert.ok(result.some(item => item.phoneCountry === "LB"), `${locale}: ${query}`);
    }
    assert.equal(phoneCountryOptions(locale, "no-such-country-9999").length, 0);
    const lebanon = phoneCountryOptions(locale, "+961").find(item => item.phoneCountry === "LB");
    assert.equal(lebanon.name, locale === "ar" ? "لبنان" : "Lebanon");
    assert.equal(lebanon.callingCode, "961");
  }
});

test("Arabic sorting/search works without Intl.Collator or Intl (Hermes fallback)", () => {
  const intl = globalThis.Intl;
  const collator = Object.getOwnPropertyDescriptor(intl, "Collator");
  const check = () => {
    const options = phoneCountryOptions("ar");
    assert.equal(options.length, PHONE_COUNTRIES.length);
    assert.ok(options.findIndex(item => item.phoneCountry === "TN") < options.findIndex(item => item.phoneCountry === "LB"));
    assert.ok(phoneCountryOptions("ar", "Lebanon").some(item => item.phoneCountry === "LB"));
    assert.deepEqual(phoneCountryOptions("en").map(item => item.phoneCountry), PHONE_COUNTRIES.map(item => item.phoneCountry));
  };
  try {
    Object.defineProperty(intl, "Collator", { value: undefined, configurable: true });
    check();
    globalThis.Intl = undefined;
    check();
  } finally {
    globalThis.Intl = intl;
    Object.defineProperty(intl, "Collator", collator);
  }
});

test("every Arabic count family has all CLDR forms and preserves interpolation contracts", () => {
  const params = (value) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, value] of Object.entries(en)) assert.deepEqual(params(ar[key]), params(value), key);
  const families = Object.keys(en).filter(key => key.endsWith(".one") && key.replace(/\.one$/, ".other") in en).map(key => key.slice(0, -4));
  for (const family of families) {
    for (const category of ["zero", "one", "two", "few", "many", "other"]) {
      const key = `${family}.${category}`;
      assert.ok(ar[key]?.trim(), key);
      // Zero/dual forms may express count as a word; other interpolation values
      // (e.g. home/away team names) must never disappear or be invented.
      const expected = params(en[`${family}.other`]);
      const actual = params(ar[key]);
      if (category === "zero" || category === "two") {
        assert.deepEqual(actual.filter(p => p !== "count"), expected.filter(p => p !== "count"), key);
      } else assert.deepEqual(actual, expected, key);
    }
  }
  for (const key of Object.keys(ar).filter(key => !(key in en))) {
    assert.match(key, /\.(zero|two|few|many)$/);
    assert.ok(`${key.replace(/\.[^.]+$/, "")}.other` in en, key);
  }
});

test("Arabic quantities use singular, dual, few, many and other forms in labels and buttons", () => {
  const quantities = new Map([[0, "لا تذاكر"], [1, "1 تذكرة"], [2, "تذكرتان"], [3, "3 تذاكر"], [10, "10 تذاكر"], [11, "11 تذكرة"], [99, "99 تذكرة"], [100, "100 تذكرة"], [101, "101 تذكرة"], [102, "102 تذكرة"], [103, "103 تذاكر"], [1.5, "1.5 تذكرة"]]);
  for (const [count, expected] of quantities) assert.equal(arabic.plural("transaction.ticketCount", count), expected);
  for (const [count, expected] of [[1, "احجز 1 مقعد"], [2, "احجز مقعدين"], [3, "احجز 3 مقاعد"], [11, "احجز 11 مقعدًا"], [100, "احجز 100 مقعد"]]) assert.equal(arabic.plural("seats.hold", count), expected);
  for (const [count, expected] of [[1, "أضف 1 تذكرة إلى السلة"], [2, "أضف تذكرتين إلى السلة"], [3, "أضف 3 تذاكر إلى السلة"], [11, "أضف 11 تذكرة إلى السلة"]]) assert.equal(arabic.plural("selection.addCount", count), expected);
  assert.equal(arabic.plural("home.tickets.next", 2, { home: "Nejmeh", away: "Ansar" }), "تذكرتان لمباراة Nejmeh ضد Ansar");
  assert.equal(arabic.t("myTickets.fixture", { home: "Nejmeh", away: "Ansar" }), "Nejmeh ضد Ansar");
});

test("billing rows carry direction metadata even when translated labels are identical", async () => {
  const source = await read("../app/checkout.tsx");
  const ast = parse(source);
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "billingRows") initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const rows = vm.runInNewContext(`(${initializer})`, { i18n: { t: () => "same label" }, name: "علي", email: "a@example.com", canonicalPhone: "+96171000000" });
  assert.deepEqual(Array.from(rows, row => row.isLTR), [false, true, true]);
  assert.match(source, /row\.value && row\.isLTR/);
  assert.doesNotMatch(source, /row\.label\s*!==/);
});

test("native SDK-load reason selects localized copy while all payment events retain their behavior", async () => {
  const source = await read("../components/CybersourceUnifiedCheckout.native.tsx");
  const ast = parse(source);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["jsStringLiteral", "buildCheckoutHtml"].includes(node.name?.text)).map(node => node.getText(ast)).join("\n");
  const htmlContext = vm.createContext({ config: { cybersourceUnifiedCheckoutUrl: "https://payments.example.test/sdk.js" } });
  vm.runInContext(compile(functions), htmlContext);
  const html = vm.runInContext('buildCheckoutHtml("context")', htmlContext);
  const messages = [];
  const bridge = vm.createContext({ window: { addEventListener() {}, ReactNativeWebView: { postMessage: text => messages.push(JSON.parse(text)) } } });
  vm.runInContext(/<script>([\s\S]*?)<\/script>/.exec(html)[1], bridge);
  const onerror = /<script src=[\s\S]*?onerror="([^"]+)"/.exec(html)[1];
  vm.runInContext(onerror, bridge);
  vm.runInContext("fail()", bridge);
  assert.deepEqual(messages, [{ type: "error", reason: "sdk_load_failed" }, { type: "error" }]);
  let handler;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleMessage") handler = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const errors = [], errorDetails = [], successes = [], statuses = [], heights = [];
  // shownRef/lockedRef/webViewRef: the form-shown flag and the input lock the handler also maintains.
  const context = vm.createContext({ translate, CHECKOUT_MAX_HEIGHT: 2200, completedRef: { current: false },
    shownRef: { current: false }, lockedRef: { current: false }, webViewRef: { current: null },
    setStatus: value => statuses.push(value), setError: () => {}, setWebViewHeight: value => heights.push(value),
    onErrorRef: { current: (value, details) => { errors.push(value); errorDetails.push(details); } }, onSuccessRef: { current: value => successes.push(value) } });
  vm.runInContext(compile(`const handler = ${handler};`), context);
  const send = payload => { context.event = { nativeEvent: { data: JSON.stringify(payload) } }; vm.runInContext("handler(event)", context); };
  for (const locale of ["en", "ar"]) {
    publishAppLocale(locale);
    send(messages[0]); assert.equal(errors.at(-1), (locale === "ar" ? ar : en)["payment.form.sdkFailed"]);
    send(messages[1]); assert.equal(errors.at(-1), (locale === "ar" ? ar : en)["payment.form.generic"]);
    send({ type: "error", message: "legacy provider message" }); assert.equal(errors.at(-1), "legacy provider message");
  }
  assert.ok(errorDetails.every((details) => details.afterShown === false && details.terminated === false), "errors before the form was shown");
  send({ type: "ready" }); assert.equal(statuses.at(-1), "ready");
  send({ type: "error", message: "declined or failed after the form was shown" });
  assert.equal(errorDetails.at(-1).afterShown, true, "an error after the form was shown is reported as such");
  assert.equal(errorDetails.at(-1).terminated, false);
  send({ type: "height", height: 300 }); send({ type: "height", height: 9000 }); assert.deepEqual(heights, [300]);
  send({ type: "success", token: "same-real-token" }); send({ type: "success", token: "same-real-token" });
  assert.deepEqual(successes, ["same-real-token"], "success remains at most once");
});
