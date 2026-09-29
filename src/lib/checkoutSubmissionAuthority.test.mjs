import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCheckoutSubmissionAuthority } from "./checkoutSubmissionAuthority.ts";

test("current checkout submission remains authoritative", () => {
  const authority = createCheckoutSubmissionAuthority();
  authority.mount();
  const ticket = authority.begin("session-a");

  assert.equal(authority.isCurrent(ticket), true);
});

test("checkout unmount invalidates a pending submission", () => {
  const authority = createCheckoutSubmissionAuthority();
  authority.mount();
  const ticket = authority.begin("session-a");

  authority.unmount();

  assert.equal(authority.isCurrent(ticket), false);
  assert.equal(authority.finish(ticket), false);
});

test("newer generation supersedes an older generation with the same session ID", () => {
  const authority = createCheckoutSubmissionAuthority();
  authority.mount();
  const older = authority.begin("session-a");
  const newer = authority.begin("session-a");

  assert.equal(authority.isCurrent(older), false);
  assert.equal(authority.isCurrent(newer), true);
});

test("current finalization releases exactly its own submission", () => {
  const authority = createCheckoutSubmissionAuthority();
  authority.mount();
  const ticket = authority.begin("session-a");

  assert.equal(authority.finish(ticket), true);
  assert.equal(authority.isCurrent(ticket), false);
});

test("old finalization cannot release newer submission ownership", () => {
  const authority = createCheckoutSubmissionAuthority();
  authority.mount();
  const older = authority.begin("session-a");
  const newer = authority.begin("session-b");

  assert.equal(authority.finish(older), false);
  assert.equal(authority.isCurrent(newer), true);
});

test("checkout source retains synchronous duplicate-submit protection", async () => {
  const source = await readFile(
    new URL("../app/checkout.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /if \(\s*!cart\.sessionId \|\|\s*!paymentMethod \|\|\s*submitInFlightRef\.current \|\|\s*blueHandoffStartedRef\.current\s*\)\s*return;/,
  );
  assert.match(source, /submitInFlightRef\.current = true;/);
});

test("checkout response and stale error publication are ownership-gated", async () => {
  const source = await readFile(
    new URL("../app/checkout.tsx", import.meta.url),
    "utf8",
  );
  const responseIndex = source.indexOf("const response = await checkoutService.submit");
  const firstOwnershipIndex = source.indexOf(
    "!checkoutSubmissionAuthority.isCurrent(submissionTicket)",
    responseIndex,
  );
  const handoffIndex = source.indexOf("launchBluePayment(validatedUrl", responseIndex);
  const catchIndex = source.indexOf("} catch (err) {", responseIndex);
  const catchOwnershipIndex = source.indexOf(
    "checkoutSubmissionAuthority.isCurrent(submissionTicket)",
    catchIndex,
  );
  const toastIndex = source.indexOf("toast.showToast({", catchIndex);

  assert.ok(responseIndex >= 0);
  assert.ok(firstOwnershipIndex > responseIndex);
  assert.ok(handoffIndex > firstOwnershipIndex);
  assert.ok(catchOwnershipIndex > catchIndex);
  assert.ok(toastIndex > catchOwnershipIndex);
});

test("Blue handoff is created while the authoritative cart session remains active", async () => {
  const source = await readFile(
    new URL("../app/checkout.tsx", import.meta.url),
    "utf8",
  );
  const blueIndex = source.indexOf("const submitBlue = async");
  const handoffIndex = source.indexOf(
    "launchBluePayment(validatedUrl, submissionTicket.sessionId)",
    blueIndex,
  );
  const blueBranchEnd = source.indexOf("const canContinue", blueIndex);
  const blueBranch = source.slice(blueIndex, blueBranchEnd);

  assert.ok(handoffIndex > blueIndex);
  assert.doesNotMatch(blueBranch, /clearCartIfSession/);
  assert.match(blueBranch, /launchBluePayment/);
});

test("returning from BLUE releases the route-launch guard and reuses the same session attempt", async () => {
  const source = await readFile(
    new URL("../app/checkout.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /useFocusEffect\(\s*useCallback\(\(\) => \{[\s\S]*blueHandoffStartedRef\.current = false;/);
  assert.match(source, /readPendingBluePaymentAttempt\(\s*cartSessionTicket\.sessionId as string,?\s*\)/);
  assert.match(source, /launchBluePayment\(\s*reusableAttempt\.paymentUrl,\s*reusableAttempt\.sessionId,?\s*\)/);
  assert.match(source, /savePendingBluePaymentAttempt\(\{/);
});
test("card payment is a dedicated route rather than a Checkout modal", async () => {
  const source = await readFile(new URL("../app/checkout.tsx", import.meta.url), "utf8");
  const cardScreen = await readFile(new URL("../components/CardPaymentScreen.tsx", import.meta.url), "utf8");
  const cardProvider = await readFile(new URL("../components/CybersourceUnifiedCheckout.native.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /<Modal[\s>]/);
  assert.match(source, /pathname: "\/checkout\/card\/payment"/);
  assert.doesNotMatch(source, /Card payment is not ready/);
  assert.doesNotMatch(source, /Please wait while secure card payment is prepared/);
  assert.match(source, /prepareCaptureContext: \(force = false\) =>/);
  assert.match(cardScreen, /fullscreen/);
  assert.doesNotMatch(cardScreen, /<Screen[\s>]/);
  assert.match(cardScreen, /root: \{ flex: 1, width: "100%" \}/);
  assert.match(cardScreen, /paymentArea: \{ flex: 1, width: "100%" \}/);
  assert.match(cardProvider, /fullscreenFrame: \{ flex: 1, borderWidth: 0, borderRadius: 0 \}/);
  assert.match(cardProvider, /requestAnimationFrame\(\(\) => requestAnimationFrame\(markReady\)\)/);
  assert.match(cardProvider, /Unable to load payment\. Please try again\./);
  // Loading and retry copy now comes from the catalog (Phase 4); the states themselves are unchanged.
  const catalog = await readFile(new URL("../i18n/messages/en.ts", import.meta.url), "utf8");
  assert.match(catalog, /"payment\.card\.loading": "Loading payment\.\.\."/);
  assert.match(catalog, /"payment\.retry": "Retry"/);
  assert.match(cardScreen, /i18n\.t\("payment\.card\.loading"\)/);
  assert.match(cardScreen, /handoff\.prepareCaptureContext\(force\)/);
  assert.match(cardScreen, /action=\{\{ label: i18n\.t\("payment\.retry"\), onPress: \(\) => void preparePayment\(true\) \}\}/);
  assert.match(cardScreen, /router\.dismissTo\("\/checkout"\)/);
});
test("payment cancellation preserves cart and success owns conditional cleanup", async () => {
  const cardScreen = await readFile(new URL("../components/CardPaymentScreen.tsx", import.meta.url), "utf8");
  const blueScreen = await readFile(new URL("../components/BluePaymentScreen.native.tsx", import.meta.url), "utf8");

  const cardBack = cardScreen.slice(cardScreen.indexOf("const returnToCheckout"), cardScreen.indexOf("useEffect", cardScreen.indexOf("const returnToCheckout")));
  const blueFailure = blueScreen.slice(blueScreen.indexOf('if (result === "failed")'), blueScreen.indexOf("const ticket", blueScreen.indexOf('if (result === "failed")')));
  assert.doesNotMatch(cardBack, /clearCart/);
  assert.doesNotMatch(blueFailure, /clearCart/);
  assert.match(cardScreen, /await cart\.clearCartIfSession\(cartTicket\)/);
  assert.match(blueScreen, /await cart\.clearCartIfSession\(ticket\)/);
});

test("background Checkout cannot replace authoritative Card success with Cart", async () => {
  const checkout = await readFile(new URL("../app/checkout.tsx", import.meta.url), "utf8");
  const cardScreen = await readFile(new URL("../components/CardPaymentScreen.tsx", import.meta.url), "utf8");

  assert.match(checkout, /if \(isFocused && !cart\.isLoading && !cart\.sessionId && !cart\.items\.length\)\s*router\.replace\("\/cart"\)/);
  assert.match(cardScreen, /await cart\.clearCartIfSession\(cartTicket\)/);
  assert.match(cardScreen, /resetRouter\.dismissAll\?\.\(\)/);
  assert.match(cardScreen, /pathname: "\/checkout\/success"/);
});
