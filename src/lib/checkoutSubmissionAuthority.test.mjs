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
    /if \(!cart\.sessionId \|\| submitInFlightRef\.current \|\| blueHandoffStartedRef\.current\) return;/,
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
  const paymentBranchIndex = source.indexOf(
    'if (paymentMethod === "blue")',
    responseIndex,
  );
  const catchIndex = source.indexOf("} catch (err) {", responseIndex);
  const catchOwnershipIndex = source.indexOf(
    "checkoutSubmissionAuthority.isCurrent(submissionTicket)",
    catchIndex,
  );
  const toastIndex = source.indexOf("toast.showToast({", catchIndex);

  assert.ok(responseIndex >= 0);
  assert.ok(firstOwnershipIndex > responseIndex);
  assert.ok(paymentBranchIndex > firstOwnershipIndex);
  assert.ok(catchOwnershipIndex > catchIndex);
  assert.ok(toastIndex > catchOwnershipIndex);
});

test("Blue handoff is created only after conditional clear and revalidation", async () => {
  const source = await readFile(
    new URL("../app/checkout.tsx", import.meta.url),
    "utf8",
  );
  const blueIndex = source.indexOf('if (paymentMethod === "blue")');
  const clearIndex = source.indexOf(
    "await cart.clearCartIfSession(cartSessionTicket)",
    blueIndex,
  );
  const postClearCheckIndex = source.indexOf(
    "!cart.isCartSessionCurrent(clearedCartTicket)",
    clearIndex,
  );
  const handoffIndex = source.indexOf(
    "createBluePaymentHandoff(validatedUrl)",
    clearIndex,
  );

  assert.ok(clearIndex > blueIndex);
  assert.ok(postClearCheckIndex > clearIndex);
  assert.ok(handoffIndex > postClearCheckIndex);
});

test("CyberSource navigation and finalization are ownership-gated", async () => {
  const source = await readFile(
    new URL("../app/checkout.tsx", import.meta.url),
    "utf8",
  );
  const resultIndex = source.indexOf(
    "const resultParams = checkoutResultRouteParams",
  );
  const clearIndex = source.indexOf(
    "await cart.clearCartIfSession(cartSessionTicket)",
    resultIndex,
  );
  const postClearCheckIndex = source.indexOf(
    "!cart.isCartSessionCurrent(clearedCartTicket)",
    clearIndex,
  );
  const navigationIndex = source.indexOf(
    'router.replace({ pathname: "/checkout/success"',
    clearIndex,
  );
  const finishIndex = source.indexOf(
    "checkoutSubmissionAuthority.finish(submissionTicket)",
    navigationIndex,
  );

  assert.ok(clearIndex > resultIndex);
  assert.ok(postClearCheckIndex > clearIndex);
  assert.ok(navigationIndex > postClearCheckIndex);
  assert.ok(finishIndex > navigationIndex);
});