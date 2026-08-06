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
const successRouteSource = await readFile(new URL("../app/checkout/success.tsx", import.meta.url), "utf8");
const failedRouteSource = await readFile(new URL("../app/checkout/failed.tsx", import.meta.url), "utf8");
const {
  getCheckoutResultMetadata,
  getCheckoutResultPresentation,
} = await importTypeScript(new URL("../lib/checkoutResultPresentation.ts", import.meta.url));
const { parseCheckoutResultParams } = await importTypeScript(
  new URL("../lib/checkoutResultParams.ts", import.meta.url),
);

test("success headings are provider-aware with a safe unknown fallback", () => {
  assert.equal(getCheckoutResultPresentation("success", "blue").title, "Blue Wallet payment successful");
  assert.equal(getCheckoutResultPresentation("success", "cybersource").title, "Card payment successful");
  assert.equal(getCheckoutResultPresentation("success", "unknown").title, "Payment successful");
});

test("failure headings are provider-aware with a safe unknown fallback", () => {
  assert.equal(getCheckoutResultPresentation("failed", "blue").title, "Blue Wallet payment failed");
  assert.equal(getCheckoutResultPresentation("failed", "cybersource").title, "Card payment failed");
  assert.equal(getCheckoutResultPresentation("failed", "unknown").title, "Payment failed");
});

test("announcement text is the safe provider-aware heading only", () => {
  const result = getCheckoutResultPresentation("failed", "blue");
  assert.equal(result.title, "Blue Wallet payment failed");
  assert.doesNotMatch(result.title, /order|reference|declined/i);
});

test("success and failure actions preserve labels and destinations", () => {
  assert.deepEqual(
    getCheckoutResultPresentation("success", "blue").secondaryAction,
    { title: "View tickets", href: "/profile" },
  );
  assert.deepEqual(
    getCheckoutResultPresentation("failed", "cybersource").secondaryAction,
    { title: "Browse matches", href: "/matches" },
  );
  assert.match(componentSource, /title="Return home"/);
  assert.match(componentSource, /router\.replace\("\/"\)/);
});

test("order number takes precedence over order ID", () => {
  const metadata = getCheckoutResultMetadata({
    provider: "blue",
    order_number: "ORDER-NUMBER",
    order_id: "ORDER-ID",
  });
  assert.deepEqual(metadata, [{ label: "Order", value: "ORDER-NUMBER" }]);
});

test("order ID is displayed when order number is absent", () => {
  const metadata = getCheckoutResultMetadata({ provider: "blue", order_id: "ORDER-ID" });
  assert.deepEqual(metadata, [{ label: "Order", value: "ORDER-ID" }]);
});

test("reference, payment reference, and status parsing remain unchanged", () => {
  const parsed = parseCheckoutResultParams({
    provider: "cybersource",
    payment_reference: "PAYMENT-REFERENCE",
    status: "paid",
  });
  assert.deepEqual(getCheckoutResultMetadata(parsed), [
    { label: "Reference", value: "PAYMENT-REFERENCE" },
    { label: "Status", value: "paid" },
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
  assert.match(componentSource, /accessible=\{false\}/);
  assert.match(componentSource, /accessibilityElementsHidden/);
  assert.match(componentSource, /importantForAccessibility="no-hide-descendants"/);
  assert.match(componentSource, /accessibilityRole="header"/);
});

test("result announcement is guarded against unrelated rerenders", () => {
  assert.match(componentSource, /AccessibilityInfo\.announceForAccessibility\(presentation\.title\)/);
  assert.match(componentSource, /announcedResultRef\.current === announcementKey/);
});

test("CyberSource uses the same presentation and metadata configuration", () => {
  const presentation = getCheckoutResultPresentation("success", "cybersource");
  const metadata = getCheckoutResultMetadata({
    provider: "cybersource",
    order_number: "ORDER",
    reference: "REFERENCE",
    status: "paid",
  });
  assert.equal(presentation.title, "Card payment successful");
  assert.equal(metadata.length, 3);
});
