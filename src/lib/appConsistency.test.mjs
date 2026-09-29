import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("payment selection uses shared method artwork and no raw forward glyph", async () => {
  const checkout = await readFile(new URL("../app/checkout.tsx", import.meta.url), "utf8");
  const sheet = await readFile(new URL("../components/PaymentMethodSheet.tsx", import.meta.url), "utf8");
  const options = await readFile(new URL("../components/checkout/PaymentMethodOptions.tsx", import.meta.url), "utf8");
  await access(new URL("../../assets/images/blue-logo.png", import.meta.url));

  // Phase 4: selection is an inline radio group built on the shared method artwork.
  assert.match(checkout, /<PaymentMethodOptions\s/);
  assert.match(options, /<PaymentMethodIcon method=\{method\.id\}/);
  assert.doesNotMatch(checkout, /\{">"\}/);
  assert.doesNotMatch(options, /\{">"\}/);
  assert.match(sheet, /blue-logo\.png/);
  assert.match(sheet, /onSelect\(option\.id\);\s*onClose\(\);/);
});

test("product confirmation uses the shared alert dialog rather than native Alert", async () => {
  const blue = await readFile(new URL("../components/BluePaymentScreen.native.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../context/AlertDialogContext.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(blue, /Alert\.alert/);
  assert.match(blue, /alertDialog\.showAlert/);
  assert.match(dialog, /variant\?: AlertVariant/);
  assert.match(dialog, /"info" \| "confirm" \| "destructive"/);
});

test("Cart header and hardware Back share true-history behavior with a Home fallback", async () => {
  const cart = await readFile(new URL("../app/cart.tsx", import.meta.url), "utf8");

  assert.match(cart, /const goBack = useCallback/);
  assert.match(cart, /if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\("\/"\);/);
  assert.match(cart, /onBack=\{goBack\}/);
  assert.match(cart, /hardwareBackPress[\s\S]*goBack\(\)/);
});

test("Match Details preserves itself beneath Cart", async () => {
  const match = await readFile(new URL("../app/match/[id].tsx", import.meta.url), "utf8");
  assert.match(match, /router\.navigate\("\/cart"\)/);
  assert.doesNotMatch(match, /router\.replace\("\/cart"\)/);
});
