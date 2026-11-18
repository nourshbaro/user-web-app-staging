import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearCardPaymentHandoff,
  createCardPaymentHandoff,
  discardStaleCardPaymentRetry,
  findCardPaymentRetry,
  readCardPaymentHandoff,
  saveCardPaymentRetry,
  takeCardPaymentRetry,
} from "../../lib/cardPaymentHandoff.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
// Contracts apply to code, not to comments that describe forbidden things.
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const hook = strip(await read("../../hooks/useCartLineActions.ts"));
const cartScreen = strip(await read("../../app/cart.tsx"));
const cartSheet = strip(await read("../CartSheet.tsx"));
const lineItem = strip(await read("./CartLineItem.tsx"));
const reservation = strip(await read("./ReservationStatus.tsx"));
const expiredSheet = strip(await read("./HoldExpiredSheet.tsx"));
const orderSummary = strip(await read("./OrderSummary.tsx"));
const holdersBlock = strip(await read("../TicketHoldersBlock.tsx"));
const holdersScreen = strip(await read("../../app/checkout/ticket-holders.tsx"));
const checkout = strip(await read("../../app/checkout.tsx"));
const methods = strip(await read("../checkout/PaymentMethodOptions.tsx"));
const card = strip(await read("../CardPaymentScreen.tsx"));
const blue = strip(await read("../BluePaymentScreen.native.tsx"));
const layout = strip(await read("../../app/_layout.tsx"));

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section ${start} not found`);
  return source.slice(from, to);
}

test("cart-line actions go through CartContext and are judged by the published cart", () => {
  assert.deepEqual(hook.match(/cart\.(addItem|updateItem|removeItem|removeItems|refreshCart|clearCart\w*)\(/g), [
    "cart.updateItem(",
    "cart.removeItems(",
    "cart.refreshCart(",
  ]);
  const setQuantity = section(hook, "const setQuantity = async", "const removeLine = async");
  assert.match(setQuantity, /if \(busy \|\| cart\.isCartReconciliationRequired\(\) \|\| !lockKey \|\| quantity < 1 \|\| quantity === line\.quantity\) return;/, "no duplicate, zero or gated mutation");
  assert.match(setQuantity, /quantityChangeConfirmed\(publication, \{/);
  assert.match(setQuantity, /cart\.requireCartReconciliation\("unconfirmed-mutation"\);/, "an unverified change raises the shared gate");
  const removeLine = section(hook, "const removeLine = async", "const checkCart = async");
  assert.match(removeLine, /if \(busy \|\| cart\.isCartReconciliationRequired\(\)\) return;/);
  assert.match(removeLine, /alertDialog\.showAlert\(/, "removal is confirmed by the user first");
  // The plan comes from the current published cart; the result comes from the delete itself.
  assert.match(removeLine, /const lockKeys = remainingLockKeys\(line\.lockKeys, cart\.items\);/);
  assert.match(removeLine, /const result = await cart\.removeItems\(lockKeys\);/);
  assert.doesNotMatch(removeLine, /cart\.refreshCart\(/, "absence after a later refresh is never proof");
  assert.match(removeLine, /case "confirmed": \{\s*const confirmed = removalConfirmed\(result\.publication, \{/);
  assert.match(removeLine, /case "sessionEnded":[\s\S]*cart\.removal\.sessionEnded\.title/);
  assert.ok(removeLine.indexOf("cart.removed.title") > removeLine.indexOf("removalConfirmed("), "success only after verification");
  assert.ok(removeLine.indexOf("cart.removed.title") < removeLine.indexOf('case "sessionEnded"'), "only the confirmed branch reports removal");
  const checkCart = section(hook, "const checkCart = async", "return { pendingLineKey");
  assert.match(checkCart, /const publication = await cart\.refreshCart\(\);\s*if \(publication\.confirmed\) return;/, "the owner releases the gate on a confirmed read");
  // No local copy of the cart and no local gate.
  assert.doesNotMatch(hook, /useState<[^>]*CartItem|setItems|items\.filter|storage\.|setNeedsCartCheck/);
  assert.match(hook, /const needsCartCheck = reconciliationActive\(cart\.cartReconciliation, cart\.sessionId\);/);
});

test("unknown outcomes block further cart actions until a confirmed refresh", () => {
  assert.match(hook, /if \(failureNeedsReconcile\(kind\)\) \{\s*reportUnconfirmed\(error\);/);
  // The backend's reason is shown, followed by the re-check guidance.
  assert.match(hook, /message: reasonWithGuidance\(error, i18n\.t\("cart\.unconfirmed\.message"\)\)/);
  for (const [name, source] of [["cart", cartScreen], ["sheet", cartSheet]]) {
    assert.match(source, /actions\.needsCartCheck \|\| cart\.isLoading/, name);
    assert.match(source, /label: i18n\.t\("cart\.check\.action"\)/, name);
  }
});

test("Cart shows the owner's total, blocks checkout when expired or unconfirmed, and never clears", () => {
  // The only total shown is the owner's authoritative cart.total.
  assert.match(cartScreen, /const totalLabel = formatMoney\(cart\.total, cart\.currency\);/);
  assert.match(cartScreen, /<AppText variant="displayNumeral" style=\{local\.totalValue\}>\{totalLabel\}<\/AppText>/);
  assert.doesNotMatch(cartScreen, /reduce\(|\.subtotal \+|unit_price \*/, "no client-side total");
  assert.match(cartScreen, /const checkoutBlocked =\s*viewState !== "active" \|\| cart\.isLoading \|\| actions\.busy \|\| actions\.needsCartCheck;/);
  assert.match(cartScreen, /if \(checkoutBlocked\) return;\s*router\.replace\("\/checkout\/ticket-holders"\);/);
  assert.match(cartSheet, /if \(blocked\) return;\s*onClose\(\);\s*router\.navigate\("\/checkout\/ticket-holders"\);/);
  for (const source of [cartScreen, cartSheet, lineItem, orderSummary]) {
    assert.doesNotMatch(source, /clearCart|clearCartIfSession|removeItem\(|updateItem\(/);
  }
  assert.match(cartScreen, /<StatePanel\s+variant="empty"/);
  assert.match(cartScreen, /variant="error"\s+title=\{i18n\.t\("cart\.refreshFailed\.title"\)\}/);
  assert.match(cartScreen, /title=\{i18n\.t\("cart\.expired\.title"\)\}/);
});

test("the reservation countdown is read-only, urgency is not colour-only, and announcements are thresholded", () => {
  assert.doesNotMatch(reservation, /useCart|setInterval|setTimeout|clearCart|refreshCart/);
  assert.match(reservation, /accessibilityRole="timer"/);
  assert.match(reservation, /if \(RANK\[urgency\] <= RANK\[previous\]\) return;/);
  assert.match(reservation, /cart\.reservation\.low|cart\.reservation\.critical/);
  // The v3 expired sheet presents the owner's snapshot; it never clears, refreshes or re-reserves.
  assert.doesNotMatch(expiredSheet, /clearCart|refreshCart|removeItem|addItem|updateItem|setInterval|expires_?at/);
  assert.match(expiredSheet, /const hold = cart\.expiredHold;/);
  assert.doesNotMatch(layout, /ReservationExpiryNotice/);
});

test("cart lines expose named, state-aware controls and no optimistic change", () => {
  assert.match(lineItem, /accessibilityLabel=\{i18n\.t\("cart\.line\.removeA11y", \{ zone \}\)\}/);
  assert.match(lineItem, /aria-disabled=\{blocked\}/);
  assert.match(lineItem, /const minusDisabled = disabled \|\| quantity <= 1;/);
  assert.match(lineItem, /aria-busy=\{busy\}/);
  assert.doesNotMatch(lineItem, /useState|useCart/);
});

test("the ticket-holder summary has no nested interactive controls", () => {
  assert.doesNotMatch(holdersBlock, /Collapsible|headerRight/);
  assert.match(holdersBlock, /<SectionHeader[\s\S]*action=\{\{\s*label: i18n\.t\("checkout\.holders\.edit"\)/);
  assert.equal((holdersBlock.match(/<Pressable/g) ?? []).length, 1, "only the separate show-all toggle");
  assert.match(holdersBlock, /aria-expanded=\{expanded\}/);
  assert.match(holdersBlock, /router\.navigate\("\/checkout\/ticket-holders\?edit=1"\)/);
});

test("the holder form keeps its rule and navigation, and focuses the first incomplete field", () => {
  const finish = section(holdersScreen, "const finish = () => {", "if (!ticketSlots.length) return null;");
  assert.match(finish, /if \(completeness\.firstIncompleteKey\) \{\s*setShowErrors\(true\);/);
  assert.match(finish, /focusSlot\(completeness\.firstIncompleteKey\);\s*return;/);
  assert.match(finish, /if \(isEditMode\) router\.dismissTo\("\/checkout"\);\s*else router\.replace\("\/checkout"\);/);
  assert.match(holdersScreen, /if \(isEditMode\) \{\s*router\.dismissTo\("\/checkout"\);\s*return;\s*\}\s*router\.replace\("\/cart"\);/);
  // Empty → Cart, except while the owner presents an expired hold (it already routed Home).
  assert.match(holdersScreen, /if \(!ticketSlots\.length && !cart\.expiredHold\) router\.replace\("\/cart"\);/);
  assert.match(holdersScreen, /initializeFirstHolder\(firstSlot\.key, profileName\)/);
  assert.match(holdersScreen, /aria-invalid=\{showError\}/);
  assert.match(holdersScreen, /accessibilityLabel=\{i18n\.t\("holders\.field\.a11y", \{ ticket: slot\.label \}\)\}/);
  // Names stay in the existing owner.
  assert.doesNotMatch(holdersScreen, /useState<Record<string, string>>|storage\./);
});

test("checkout readiness includes expiry, the payload builder is shared, and nothing clears the cart", () => {
  assert.match(checkout, /const readiness = checkoutReadiness\(\{\s*itemCount: cart\.items\.length,\s*secondsLeft: cart\.secondsLeft,/);
  assert.match(checkout, /const canContinue = readiness\.ready;/);
  assert.equal((checkout.match(/buildTicketsByMatch\(ticketSlots, holderNames\)/g) ?? []).length, 3, "BLUE, card and free use the same payload");
  // The only clear on Checkout is a confirmed free order's (it has no payment
  // screen); its conditions are pinned in freeCheckout.test.mjs.
  const submitFree = section(checkout, "const submitFree = async", "const submitBlue = async");
  assert.doesNotMatch(checkout.replace(submitFree, ""), /clearCart/);
  assert.match(checkout, /busy: loading/);
  assert.match(checkout, /disabled: !canContinue/);
});

test("payment methods are exactly the supported ones, with radio semantics", () => {
  // Product order: BLUE Wallet first, then "Other" (the card path); backend ids unchanged.
  assert.deepEqual(methods.match(/id: "(\w+)"/g), ['id: "blue"', 'id: "cybersource"']);
  assert.match(methods, /accessibilityRole="radiogroup"/);
  assert.match(methods, /accessibilityRole="radio"/);
  assert.match(methods, /aria-checked=\{active\}/);
});

test("submit failures show the backend's reason, and unknown outcomes are never shown as failed", () => {
  const submitBlue = section(checkout, "const submitBlue = async", "const readiness = checkoutReadiness");
  const blueCatch = section(submitBlue, "} catch (err) {", "} finally {");
  // Raw exception text is never shown; the backend's message is.
  assert.doesNotMatch(blueCatch, /err\.message/);
  assert.match(blueCatch, /paymentFailureKind\(errorFacts\(err\)\)/);
  // An unknown outcome keeps its "may have gone through" guidance after the reason.
  assert.match(blueCatch, /failure === "unknown"\s*\? reasonWithGuidance\(err, i18n\.t\("checkout\.submitFailed\.unknown"\)\)\s*: userFacingError\(/);
  const cardCatch = section(card, "} catch (submissionError) {", "} finally {");
  assert.doesNotMatch(cardCatch, /submissionError\.message/);
  assert.match(cardCatch, /reason: failureReason\(submissionError\)/);
  // After a card result (autoProcessing may already have charged the card),
  // no status, 4xx included, is presented as "not completed": it is unresolved.
  assert.doesNotMatch(cardCatch, /paymentFailureKind|notCompleted|payment\.failed\.title/);
  assert.match(cardCatch, /kind: "unresolved",[\s\S]*?submitted,/);
  assert.match(card, /return failure\.kind === "unknown" \? `\$\{reason\} \$\{i18n\.t\("payment\.failed\.unknown"\)\}` : reason;/);
  // A card form that ended without a result after the payer could use it is uncertain too.
  assert.match(card, /const outcomeUncertain = failure\?\.kind === "unknown" \|\| failure\?\.kind === "locked" \|\| failure\?\.kind === "unresolved" \|\| failure\?\.kind === "formEnded";/);
  assert.match(card, /outcomeUncertain\s*\? \{ label: i18n\.t\("payment\.viewTickets"\)/);
});

test("an unknown payment outcome locks that session's payment on both methods", () => {
  const submitBlue = section(checkout, "const submitBlue = async", "const reconciliationRequired =");
  const blueCatch = section(submitBlue, "} catch (err) {", "} finally {");
  // Locked for the attempt's own session, even if Checkout is no longer mounted.
  assert.match(blueCatch, /if \(cart\.isCartSessionCurrent\(cartSessionTicket\)\) \{\s*if \(failure === "unknown"\) markPaymentOutcomeUnknown\(submissionTicket\.sessionId, "blue"\);\s*else if \(attempt\) void settlePaymentAttempt\(submissionTicket\.sessionId, attempt\.id\);/);
  const cardCatch = section(card, "} catch (submissionError) {", "} finally {");
  // Card retains the held attempt for a manual retry or locks the handoff's
  // session while it is still current. Neither path settles it.
  assert.match(cardCatch, /lockHandoffSession\(\);/);
  assert.doesNotMatch(cardCatch, /settlePaymentAttempt|markPaymentOutcomeUnknown\(/);
  assert.ok(cardCatch.indexOf("lockHandoffSession(") < cardCatch.indexOf("if (!activeRef.current) return;"), "the lock does not depend on the screen still being mounted");
  assert.match(card, /const lockHandoffSession = \(\) => \{\s*if \(binding\) markPaymentOutcomeUnknownIfLive\(binding, "card"\);\s*\};/);
  assert.doesNotMatch(card, /markPaymentOutcomeUnknown\(/, "no unguarded session-lock write anywhere on the card screen");
  // The card screen refuses to submit (and opens locked) for a changed,
  // expired, gated or locked session, from the owner's current state.
  const block = section(card, "const submitBlock = useCallback(", "const handleSuccess = useCallback(");
  assert.match(block, /const owner = cart\.readCartGuardState\(\);/);
  assert.match(block, /paymentOutcomeUnknown: readPaymentOutcomeLock\(sessionId, result\) !== null/);
  assert.match(block, /paymentAttemptInProgress: isPaymentAttemptHeldByOther\(sessionId, own\)/);
  const handle = section(card, "const handleSuccess = useCallback(", "} catch (submissionError) {");
  // The card result is recorded (in memory, synchronously) before any check can refuse it.
  const recordIndex = handle.indexOf("recordUnresolvedCardResult(");
  assert.ok(recordIndex >= 0 && recordIndex < handle.indexOf("submitBlock("), "recorded before the first check");
  // Its durable write is started there but never awaited before the submit:
  // waiting would only widen the gap between a possible charge and the order.
  const mainPath = section(handle, "ownResultRef.current = claim;", "await checkoutService.submit(");
  assert.doesNotMatch(mainPath, /await persisted|await savedKnown/, "the marker write never delays the submit");
  const savedStart = handle.indexOf("const savedKnown = persisted ? persisted.then(");
  assert.ok(savedStart > recordIndex && savedStart < handle.indexOf("const blockedAtToken"), "its outcome is tracked, then reported");
  // A refused result is kept and reported, never silently dropped. Only the
  // cart's "re-read first" gate lets the attempt be held (nothing is sent).
  assert.match(handle, /const blockedAtToken = submitBlock\(sessionId, null, claim\);[\s\S]*?if \(blockedAtToken && blockedAtToken\.kind !== "reconcile"\) \{\s*keepUnsubmitted\(blockedAtToken\);\s*return;\s*\}/);
  assert.doesNotMatch(handle, /settlePaymentAttempt/);
  // Every refusal reports the outcome. Reconciliation preserves the unsent result.
  const beforeSubmit = handle.slice(savedStart, handle.indexOf("await checkoutService.submit("));
  assert.equal((beforeSubmit.match(/return;/g) ?? []).length, (beforeSubmit.match(/keepUnsubmitted\(|saveCardPaymentRetry\(/g) ?? []).length);
  assert.match(card, /return lock\s*\? \{ kind: "locked", scope: lock\.scope, unreadable: lock\.reason === "unreadable" \}/);
  // BLUE's already-known pending URL behaviour is preserved.
  assert.match(checkout, /readPendingBluePaymentAttempt\(\s*cartSessionTicket\.sessionId as string,?\s*\)/);
});

test("both methods record the attempt, then re-check the owner, immediately before the submit", () => {
  const cardAttempt = section(card, "submittingRef.current = true;", "} catch (submissionError) {");
  const blueAttempt = section(section(checkout, "const submitBlue = async", "const reconciliationRequired ="), "const submissionTicket = checkoutSubmissionAuthority.begin(", "} catch (err) {");
  // BLUE settles a blocked attempt (nothing was charged); Card keeps it as
  // the session's lock (the card form may already have charged the card).
  for (const [name, source, record, recheck, blocked, awaits] of [
    ["card", cardAttempt, 'await acquirePaymentAttempt(sessionId, "card", claim, binding)', "submitBlock(sessionId, attempt, claim)", "keepUnsubmitted(blockedBeforeSubmit", 0],
    ["blue", blueAttempt, 'await acquirePaymentAttempt(submissionTicket.sessionId, "blue")', "cart.readCartGuardState()", "settlePaymentAttempt(", 1],
  ]) {
    const order = [record, recheck, blocked, "await checkoutService.submit("];
    let last = -1;
    for (const marker of order) {
      const index = source.indexOf(marker);
      assert.ok(index > last, `${name}: ${marker}`);
      last = index;
    }
    // Nothing between the re-check and the submit can await (no expiry window).
    const tail = source.slice(source.indexOf(recheck), source.indexOf("await checkoutService.submit("));
    assert.equal((tail.match(/await /g) ?? []).length, awaits, `${name}: awaits between the re-check and the submit`);
    assert.match(tail, /return;\s*\}\s*(const response = )?$/m, `${name}: a blocked attempt returns before submitting`);
  }
  assert.doesNotMatch(cardAttempt, /settlePaymentAttempt/, "card never settles after a card result");
  assert.match(blueAttempt, /paymentSubmitBlocker\(\{/);
  assert.match(card, /case "expired":\s*return i18n\.t\("payment\.reservationGone"\);/);
});

test("one shared attempt gate: each surface passes only its own acquisition identity", () => {
  // Final guards pass the surface's own attempt, never null, right before the submit.
  assert.match(checkout, /paymentAttemptInProgress: isPaymentAttemptHeldByOther\(submissionTicket\.sessionId, attempt\)/);
  assert.match(card, /const blockedBeforeSubmit = submitBlock\(sessionId, attempt, claim\)/);
  // A refused acquisition never submits.
  assert.match(card, /if \(!acquisition\.ok\) \{[\s\S]*?return;\s*\}\s*attempt = acquisition\.attempt;/);
  assert.match(checkout, /if \(!acquisition\.ok\) \{[\s\S]*?return;\s*\}\s*attempt = acquisition\.attempt;/);
  // The Pay handler and the rendered readiness both apply the gate before either handoff.
  const handle = section(checkout, "const handleContinue = () => {", "const payLabel");
  assert.match(handle, /paymentAttemptInProgress: attemptBlocksCheckout\(ownerState\.sessionId\),/);
  assert.match(checkout, /heldMethod: readPaymentAttempt\(sessionId\)\?\.method \?\? null,/);
  // Reopening a held BLUE URL re-acquires the gate when it was released, and yields to a Card attempt.
  const reuse = section(checkout, "if (reusableAttempt) {", "const checkoutBilling = createCheckoutBilling(");
  assert.match(reuse, /if \(held && held\.method !== "blue"\) \{[\s\S]*?return;\s*\}/);
  assert.match(reuse, /await acquirePaymentAttempt\(reusableAttempt\.sessionId, "blue"\)/);
  assert.ok(reuse.indexOf("acquirePaymentAttempt(") < reuse.indexOf("launchBluePayment("));
  // The only exported way to record an attempt is to acquire it.
  assert.doesNotMatch(checkout + card, /recordPaymentAttempt/);
});

test("the cart owner restores the payment lock with the session, before publishing it", async () => {
  const context = strip(await read("../../context/CartContext.tsx"));
  assert.match(context, /configurePaymentOutcomeStore\(\{/);
  const restore = section(context, "const persisted = parsePersistedCartSession(stored, Date.now());", "return () => {");
  const lockIndex = restore.indexOf("await restorePaymentOutcomeLock(persisted.sessionId);");
  assert.ok(lockIndex > 0);
  assert.ok(lockIndex < restore.indexOf("sessionAuthorityRef.current.replace(persisted.sessionId);"), "lock before the session is published");
  assert.ok(lockIndex < restore.indexOf("setSessionId(persisted.sessionId);"));
  assert.match(context, /if \(sessionId !== null\) void discardPaymentOutcomeUnlessSession\(sessionId\);/);
  // BLUE's provider failure redirect keeps its existing retry semantics.
  const terminal = section(blue, "const handleTerminal = useCallback", "const handleNavigation = useCallback");
  assert.match(terminal, /if \(result === "failed"\) \{[\s\S]*?if \(handoff\) void settlePaymentAttempt\(handoff\.sessionId\);/);
});

test("Checkout re-validates against the owner's current state inside the Pay handler, before either handoff", () => {
  const handle = section(checkout, "const handleContinue = () => {", "const payLabel");
  const guardIndex = handle.indexOf("const guard = submissionGuard({");
  assert.ok(guardIndex > 0);
  assert.match(handle, /const ownerState = cart\.readCartGuardState\(\);/);
  assert.match(handle, /renderedSessionId: cart\.sessionId,/);
  assert.match(handle, /if \(!guard\.ok\) \{[\s\S]*?return;\s*\}/);
  assert.ok(handle.indexOf("createCardPaymentHandoff(") > guardIndex, "card handoff after the guard");
  assert.ok(handle.indexOf("void submitBlue();") > guardIndex, "BLUE handoff after the guard");
  assert.match(checkout, /reconciliationRequired,\s*paymentOutcomeUnknown,/);
});

test("card success still requires a submit response for the current session before clearing", () => {
  const success = section(card, "response = await checkoutService.submit", "} catch (submissionError)");
  const order = ["cart.isCartSessionCurrent(cartTicket)", "await cart.clearCartIfSession(cartTicket)", 'pathname: "/checkout/success"'];
  let last = -1;
  for (const marker of order) {
    const index = success.indexOf(marker);
    assert.ok(index > last, marker);
    last = index;
  }
  // A completed submit this screen can no longer reconcile locks the session
  // (through the live binding only) instead of being dropped.
  assert.match(success, /if \(!activeRef\.current\) \{\s*lockHandoffSession\(\);\s*return;\s*\}/);
  // One completion decision gates the marker release, the cart clearing and the success screen.
  const completionGuard = 'if (cardSubmitCompletion(response) !== "complete") {';
  const decision = success.indexOf(completionGuard);
  assert.ok(decision > 0, "single completion decision");
  for (const consumer of ["await resolveUnresolvedCardResult(claim);", "await cart.clearCartIfSession(cartTicket)", 'pathname: "/checkout/success"']) {
    assert.ok(success.indexOf(consumer) > decision, `${consumer} follows the decision`);
  }
  assert.match(section(success, completionGuard, "await resolveUnresolvedCardResult(claim);"), /return;\s*\}\s*$/);
  // Hardware and header back share one synchronous (ref) guard: a submit in
  // flight, or the post-expiry grace period (leaving would tear down a form
  // that may still deliver a result). Both go through requestLeave, which
  // asks first while the form is on screen. The header is also visibly disabled.
  assert.match(card, /if \(canLeavePayment\(submittingRef\) && !expiryGraceRef\.current\) requestLeave\(\);\s*return true;/, "hardware back");
  assert.match(card, /onBack=\{\(\) => \{\s*if \(canLeavePayment\(submittingRef\) && !expiryGraceRef\.current\) requestLeave\(\);\s*\}\}/, "header back");
  assert.match(card, /backDisabled=\{processing \|\| formExpired \|\| rechecking\}/);
  const leave = section(card, "const requestLeave = useCallback(() => {", "}, [i18n, returnToCheckout]);");
  assert.match(leave, /if \(!canLeavePayment\(submittingRef\) \|\| expiryGraceRef\.current\) return;\s*if \(!cardFormVisibleRef\.current\) \{\s*returnToCheckout\(\);\s*return;\s*\}/, "no form on screen: leave at once");
  assert.match(leave, /Alert\.alert\(title, message, \[/, "form on screen: ask first (native)");
  assert.match(leave, /window\.confirm\(/, "form on screen: ask first (web)");
  assert.match(leave, /const leave = \(\) => \{\s*if \(canLeavePayment\(submittingRef\) && !expiryGraceRef\.current\) returnToCheckout\(\);/, "re-checked when confirmed");
  assert.doesNotMatch(card, /onBack=\{processing \?/, "no render-state-only guard");
});

test("a submitted card result is never sent again; only an unsent (held-back) result is sent later, once, on an explicit press", () => {
  const handle = section(card, "const handleSuccess = useCallback(", "} finally {");
  const retry = section(handle, "const blockedBeforeSubmit", 'if (cardSubmitCompletion(response) !== "complete")');
  assert.match(handle, /const snapshot = retry\?\.snapshot \?\? authSnapshot/);
  assert.match(handle, /let attempt: PaymentAttempt \| null = retry\?\.attempt \?\? null/);
  assert.match(handle, /const cartTicket = retry\?\.cartTicket \?\? cart\.captureCartSession\(\)/);
  assert.match(retry, /submitBlock\(sessionId, attempt, claim\)[\s\S]*?isCardAttemptBindingLive\(binding\)[\s\S]*?readPaymentAttempt\(sessionId\)\?\.id === attempt\.id/);
  assert.match(retry, /await checkoutService\.submit\(\s*\{ \.\.\.handoff\.request, payment: \{ transient_token: cardResult \} \},\s*\{ authentication: snapshot \}/);
  assert.doesNotMatch(retry, /acquirePaymentAttempt|resolveUnresolvedCardResult|clearCartIfSession/);
  // No replay: a transport error or timeout after the submit is never turned
  // into a retry (backend idempotency for the same result is not established).
  assert.doesNotMatch(card, /cardSubmitRetryEnabled|errorFacts|transport === null/);
  const afterSubmit = section(handle, "await checkoutService.submit(", "} catch (submissionError) {");
  assert.doesNotMatch(afterSubmit, /saveCardPaymentRetry/, "nothing after a submit is kept for sending again");
  assert.equal((handle.match(/await checkoutService\.submit\(/g) ?? []).length, 1, "one submit call");
  assert.equal((handle.match(/submitted = true;/g) ?? []).length, 1);
  assert.match(handle, /let submitted = false;/, "a retry is never a resubmission");
  // The only kept result is one the cart's "re-read first" gate held back before sending.
  const guardBlock = section(retry, "if (blockedBeforeSubmit || !snapshot) {", "submitted = true;");
  assert.match(guardBlock, /if \(snapshot && blockedBeforeSubmit\?\.kind === "reconcile"\) \{[\s\S]*?saveCardPaymentRetry\(handoffId, pending\);/);
  assert.match(guardBlock, /const pending = retry \?\? \{ cardResult, snapshot, cartTicket, claim, attempt,/);
  assert.equal((card.match(/saveCardPaymentRetry\(/g) ?? []).length, 1, "saved from that one place only");
  // Sending a held result: the cart is re-read first while its gate is up;
  // only a confirmed read (gate released, nothing in flight) takes the result.
  const press = section(card, "const retrySubmission = useCallback(", "}, [cart, handleSuccess, handoffId]);");
  assert.match(press, /if \(!activeRef\.current \|\| submittingRef\.current \|\| recheckingRef\.current\) return;/);
  assert.match(press, /confirmed = \(await cart\.refreshCart\(\)\)\.confirmed;/);
  assert.match(press, /if \(!confirmed \|\| !activeRef\.current \|\| submittingRef\.current \|\| cart\.readCartGuardState\(\)\.reconciliationRequired\) return;\s*\}\s*const retry = takeCardPaymentRetry\(handoffId\);\s*if \(retry\) void handleSuccess\(retry\.cardResult, retry\);/);
  assert.match(card, /retrySubmit"\), onPress: \(\) => void retrySubmission\(\) \}/);
  // Sent automatically once, only for a result held on its first delivery.
  assert.match(guardBlock, /if \(!retry\) autoSendHeldRef\.current = true;/);
  assert.match(card, /if \(!autoSendHeldRef\.current \|\| failure\?\.kind !== "unresolved" \|\| !failure\.canRetry \|\| processing\) return;\s*autoSendHeldRef\.current = false;\s*void retrySubmission\(\);/);
  assert.match(card, /const returnToCheckout = useCallback\(\(\) => \{\s*if \(!readCardPaymentHandoff\(handoffId\)\?\.retry\) clearCardPaymentHandoff\(handoffId\)/);
  assert.match(checkout, /cardRetryHandoffId && !reconciliationRequired[\s\S]*?onPress: openCardRetry/);
});

test("a card retry can reopen from checkout, is taken once and is discarded when ownership changes", () => {
  const id = createCardPaymentHandoff({
    sessionId: "session-1",
    accountId: "account-1",
    captureContext: null,
    prepareCaptureContext: () => { throw new Error("retry must not request card entry"); },
    request: { checkout_session_id: "session-1", payment_method: "cybersource" },
  });
  try {
    const retry = {
      cardResult: "test-result",
      snapshot: { generation: 3, token: "test-auth" },
      cartTicket: { generation: 4, sessionId: "session-1" },
      claim: { key: "test-result-key", accountId: "account-1", sessionId: "session-1" },
      attempt: { id: 5, sessionId: "session-1", method: "card" },
      reference: "test-reference",
      reason: "Connection lost",
      saved: true,
    };
    const isCurrent = (snapshot, ticket, attempt) =>
      snapshot.generation === 3 && ticket.generation === 4 && attempt.id === 5;
    saveCardPaymentRetry(id, retry);
    assert.equal(findCardPaymentRetry("session-1", "account-1", isCurrent), id);
    assert.equal(findCardPaymentRetry("session-1", "account-1", isCurrent, retry.claim.key), id);
    assert.equal(findCardPaymentRetry("session-1", "account-1", isCurrent, "different-result"), null);
    assert.equal(findCardPaymentRetry("session-1", "account-2", isCurrent), null);
    assert.equal(findCardPaymentRetry("session-2", "account-1", isCurrent), null);
    assert.equal(findCardPaymentRetry("session-1", "account-1", () => false), null);
    assert.strictEqual(readCardPaymentHandoff(id).retry, retry);
    assert.strictEqual(takeCardPaymentRetry(id), retry);
    assert.equal(takeCardPaymentRetry(id), undefined);
    assert.equal(findCardPaymentRetry("session-1", "account-1", isCurrent), null);
    saveCardPaymentRetry(id, retry);
    discardStaleCardPaymentRetry(() => false);
    assert.equal(readCardPaymentHandoff(id), null);
  } finally {
    clearCardPaymentHandoff(id);
  }
});

test("My Tickets offers sending a held result while its session lives (not gated on the client timer), and support otherwise", async () => {
  const tickets = strip(await read("../../app/tickets.tsx"));
  const recovery = section(tickets, "function UnresolvedCardPayments()", "function PortalMatchCard(");
  assert.match(recovery, /if \(owner\.itemCount === 0\) return null;/);
  assert.doesNotMatch(recovery, /owner\.expired/, "the backend, not the client timer, decides on the reservation");
  assert.match(recovery, /const canRetry = retryHandoff\(marker\.key\) !== null;/);
  assert.match(recovery, /action=\{canRetry \? \{\s*label: i18n\.t\("payment\.card\.unresolved\.retrySubmit"\)[\s\S]*?\} : \{\s*label: i18n\.t\("myTickets\.paymentPending\.support"\),\s*onPress: \(\) => router\.push\("\/contact"\)/);
});

test("BLUE keeps its WebView policy and never clears for an unmatched result", () => {
  assert.match(blue, /originWhitelist=\{\["\*"\]\}/);
  assert.match(blue, /mixedContentMode="never"/);
  assert.match(blue, /javaScriptCanOpenWindowsAutomatically=\{false\}/);
  assert.match(blue, /setSupportMultipleWindows=\{false\}/);
  assert.match(blue, /decideBlueNavigation\(/);
  const terminal = section(blue, "const handleTerminal = useCallback", "const handleNavigation = useCallback");
  // Clear is attempted once, only for the handoff's own session, and a rejection is caught.
  assert.match(terminal, /if \(!activeRef\.current \|\| terminalHandledRef\.current\) return;\s*terminalHandledRef\.current = true;/);
  assert.equal((terminal.match(/clearCartIfSession\(/g) ?? []).length, 1);
  assert.match(terminal, /if \(handoff && ticket && ticket\.sessionId === handoff\.sessionId\) \{\s*try \{\s*clear = \(await cart\.clearCartIfSession\(ticket\)\) \? "cleared" : "notCleared";\s*\} catch \{\s*clear = "threw";/);
  const failurePath = section(terminal, 'if (completion !== "success") {', "clearPendingBluePaymentAttempt(");
  assert.match(failurePath, /markPaymentOutcomeUnknown\(handoff\.sessionId, "blue"\)/);
  assert.match(failurePath, /setRecoverToTickets\(true\);/);
  assert.match(failurePath, /return;\s*\}/);
  assert.doesNotMatch(failurePath, /checkout\/success/);
  // The async terminal handler is never left to reject unhandled.
  assert.match(blue, /void handleTerminal\(navigationUrl, terminalResult\)\.catch\(/);
  assert.match(blue, /label: i18n\.t\("payment\.viewTickets"\)/);
});

test("the payment screens use the v3 flow header; its backDisabled makes Back inert and announced", async () => {
  const header = strip(await read("../FlowHeader.tsx"));
  assert.match(header, /backDisabled = false,/);
  assert.match(header, /if \(!backDisabled\) onBack\(\);/);
  assert.match(header, /disabled=\{backDisabled\}/);
  assert.match(header, /aria-disabled=\{backDisabled\}/);
  // Card keeps its in-flight guard on Back; BLUE keeps its leave confirmation.
  assert.match(card, /<FlowHeader[\s\S]*?onBack=\{\(\) => \{\s*if \(canLeavePayment\(submittingRef\) && !expiryGraceRef\.current\) requestLeave\(\);\s*\}\}\s*backDisabled=\{processing \|\| formExpired \|\| rechecking\}/);
  assert.match(blue, /<FlowHeader[^>]*onBack=\{confirmLeave\}/);
  assert.doesNotMatch(card + blue, /AppHeader|showTimer|CartTimer/);
});

test("no fabricated payment, order or ticket data enters Cart or Checkout", () => {
  for (const source of [hook, cartScreen, cartSheet, lineItem, orderSummary, holdersBlock, holdersScreen, checkout, methods, card, blue]) {
    assert.doesNotMatch(source, /Math\.random|qrCells|mock|order_id: "|setTimeout\([^)]*\d{3,}/);
  }
});

test("choosing a payment method never starts a payment; only the explicit action does", () => {
  // The option only reports the choice back to Checkout.
  assert.match(methods, /onPress=\{\(\) => onSelect\(method\.id\)\}/);
  assert.doesNotMatch(methods, /router\.|checkoutService|submit|Handoff|acquirePaymentAttempt/);
  assert.match(checkout, /onSelect=\{setPaymentMethod\}/);
  // Both handoffs live only in the explicit action's handler.
  const handle = section(checkout, "const handleContinue = () => {", "const payLabel");
  assert.match(handle, /if \(effectiveMethod === "cybersource"\) \{[\s\S]*?pathname: "\/checkout\/card\/payment"/);
  assert.match(handle, /void submitBlue\(\);/);
  // A zero-total cart has no method to choose; it submits from the same action.
  assert.match(handle, /if \(effectiveMethod === "free"\) \{\s*void submitFree\(\);\s*return;\s*\}/);
  assert.equal((checkout.match(/void submitFree\(\)/g) ?? []).length, 1, "a free order starts from one place");
  assert.equal((checkout.match(/void submitBlue\(\)/g) ?? []).length, 1, "BLUE starts from one place");
  assert.equal((checkout.match(/createCardPaymentHandoff\(/g) ?? []).length, 1, "Card starts from one place");
  assert.equal((checkout.match(/onPress: handleContinue/g) ?? []).length, 1, "one explicit Pay action");
  // Selecting Card may prepare the secure form, never submit.
  const prepare = section(checkout, "if (!shouldInitializeCaptureContext(", "return () => {");
  assert.doesNotMatch(prepare, /submit|createCardPaymentHandoff|router\./);
});

test("no card fields are drawn by the app: card entry stays in CyberSource's form", () => {
  for (const source of [checkout, methods]) {
    assert.doesNotMatch(source, /TextInput|cardNumber|card number|cvv|cvc|expiry date|MM\s*\/\s*YY/i);
  }
});

test("the holder form has exactly one field per physical ticket slot", () => {
  assert.match(holdersScreen, /group\.zones\.flatMap\(\(zone\) => zone\.entries\)\.map\(\(\{ slot, index \}, row\) => \{/);
  assert.equal((holdersScreen.match(/<HolderField\b/g) ?? []).length, 1);
  assert.match(holdersScreen, /const completeness = holderCompleteness\(ticketSlots, holderNames\);/);
  // Continue always validates and moves focus to the first unnamed ticket.
  assert.match(holdersScreen, /onPress: finish,/);
});

test("expiry and result copy claim 'no payment was taken' only when no payment ever touched the session", async () => {
  const { en } = await import("../../i18n/messages/en.ts");
  const { holdExpiredMessageKey } = await import("../../lib/holdExpiry.ts");
  for (const key of ["holdExpired.title", "holdExpired.messagePayment", "cart.expired.title", "cart.expired.message", "result.failed.message"]) {
    assert.doesNotMatch(en[key], /no payment was taken|no order was created|not charged/i, key);
  }
  // The v3 sentence is reserved for a hold no payment attempt, BLUE request or unknown outcome touched.
  assert.equal(holdExpiredMessageKey({ matchIds: ["4"], paymentTouched: true }), "holdExpired.messagePayment");
  assert.equal(holdExpiredMessageKey({ matchIds: ["4"], paymentTouched: false }), "holdExpired.message");
  assert.match(en["holdExpired.message"], /No payment was taken/);
});
