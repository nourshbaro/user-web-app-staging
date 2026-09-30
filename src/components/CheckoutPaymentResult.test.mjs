import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScript(url) {
  const source = await readFile(url, "utf8");
  const executableSource = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}`);
}

const componentSource = await readFile(new URL("./CheckoutPaymentResult.tsx", import.meta.url), "utf8");
const outcomeSource = await readFile(new URL("./checkout/PaymentOutcome.tsx", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../i18n/messages/en.ts", import.meta.url), "utf8");
const successRouteSource = await readFile(new URL("../app/checkout/success.tsx", import.meta.url), "utf8");
const failedRouteSource = await readFile(new URL("../app/checkout/failed.tsx", import.meta.url), "utf8");
const {
  getCheckoutResultMetadata,
  getCheckoutResultPresentation,
  getCheckoutResultProviderKey,
} = await importTypeScript(new URL("../lib/checkoutResultPresentation.ts", import.meta.url));
const { parseCheckoutResultParams } = await importTypeScript(
  new URL("../lib/checkoutResultParams.ts", import.meta.url),
);
const { en } = await importTypeScript(new URL("../i18n/messages/en.ts", import.meta.url));

test("success and failure use the v3 headings from the catalog", () => {
  assert.equal(en[getCheckoutResultPresentation("success").titleKey], "Payment confirmed");
  assert.equal(en[getCheckoutResultPresentation("failed").titleKey], "Payment didn't go through");
  assert.ok(catalogSource.includes('"result.success.title"'));
});

test("result copy never invents success details or claims no order exists", () => {
  const success = en[getCheckoutResultPresentation("success").messageKey];
  const failed = en[getCheckoutResultPresentation("failed").messageKey];
  // Success does not promise email delivery or ticket issue the backend did not report.
  assert.doesNotMatch(success, /sent to your email|have been issued/i);
  // A provider failure never asserts that no order or no payment exists.
  assert.doesNotMatch(failed, /no order was created|no payment was taken|not charged/i);
  assert.doesNotMatch(en["payment.unknown.title"], /fail|declin/i, "unknown is never a failure");
});

test("the provider is shown as Paid with only when it is known", () => {
  assert.equal(en[getCheckoutResultProviderKey("blue")], "BLUE Wallet");
  assert.equal(en[getCheckoutResultProviderKey("cybersource")], "Card");
  assert.equal(getCheckoutResultProviderKey("unknown"), null);
  assert.match(componentSource, /succeeded && providerKey \?/);
});

test("success and failure actions keep their destinations", () => {
  assert.deepEqual(getCheckoutResultPresentation("success").primaryAction, { labelKey: "result.success.tickets", href: "/tickets" });
  assert.deepEqual(getCheckoutResultPresentation("failed").primaryAction, { labelKey: "result.failed.browse", href: "/matches" });
  for (const outcome of ["success", "failed"]) {
    assert.deepEqual(getCheckoutResultPresentation(outcome).secondaryAction, { labelKey: "result.home", href: "/" });
  }
  assert.match(componentSource, /router\.replace\("\/"\)/);
  assert.match(componentSource, /router\.replace\(presentation\.primaryAction\.href\)/);
});

test("order number takes precedence over order ID", () => {
  const metadata = getCheckoutResultMetadata({
    provider: "blue",
    order_number: "ORDER-NUMBER",
    order_id: "ORDER-ID",
  });
  assert.deepEqual(metadata, [{ labelKey: "result.detail.order", value: "ORDER-NUMBER", mono: true }]);
});

test("order ID is displayed when order number is absent", () => {
  const metadata = getCheckoutResultMetadata({ provider: "blue", order_id: "ORDER-ID" });
  assert.deepEqual(metadata, [{ labelKey: "result.detail.order", value: "ORDER-ID", mono: true }]);
});

test("reference, payment reference, and status parsing remain unchanged", () => {
  const parsed = parseCheckoutResultParams({
    provider: "cybersource",
    payment_reference: "PAYMENT-REFERENCE",
    status: "paid",
  });
  assert.deepEqual(getCheckoutResultMetadata(parsed), [
    { labelKey: "result.detail.reference", value: "PAYMENT-REFERENCE", mono: true },
    { labelKey: "result.detail.status", value: "paid", mono: false },
  ]);
});

test("missing optional metadata remains omitted", () => {
  assert.deepEqual(getCheckoutResultMetadata({ provider: "unknown" }), []);
});

test("result routes hide only their local stack headers", () => {
  for (const source of [successRouteSource, failedRouteSource]) {
    assert.match(source, /<Stack\.Screen options=\{\{ headerShown: false \}\} \/>/);
    assert.match(source, /parseCheckoutResultParams\(params\)/);
  }
});

test("production result component centers available space while retaining scroll overflow", () => {
  assert.match(componentSource, /<ScrollView/);
  assert.match(componentSource, /contentContainerStyle=\{local\.content\}/);
  assert.match(componentSource, /content:\s*\{[^}]*flexGrow:\s*1/s);
  assert.match(componentSource, /content:\s*\{[^}]*justifyContent:\s*"center"/s);
  assert.doesNotMatch(componentSource, /cardWrap:\s*\{[^}]*height\s*:/s);
  assert.doesNotMatch(componentSource, /shell:\s*\{[^}]*justifyContent:\s*"center"/s);
  assert.doesNotMatch(componentSource, /(minHeight|height):\s*["'`]?\d+(vh|%)/);
});

test("result icon is decorative while the heading remains accessible", () => {
  const icon = outcomeSource.slice(outcomeSource.indexOf("export function PaymentOutcomeIcon"), outcomeSource.indexOf("export function PaymentOutcomePanel"));
  assert.match(icon, /accessible=\{false\}/);
  assert.match(icon, /accessibilityElementsHidden/);
  assert.match(icon, /importantForAccessibility="no-hide-descendants"/);
  assert.match(outcomeSource, /accessibilityRole="header"/);
  // The pop-in honours reduced motion.
  assert.match(icon, /if \(reducedMotion\) \{\s*scale\.setValue\(1\);/);
});

test("result announcement is guarded against unrelated rerenders", () => {
  assert.match(componentSource, /AccessibilityInfo\.announceForAccessibility\(title\)/);
  assert.match(componentSource, /announcedResultRef\.current === announcementKey/);
});
