import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
// Contracts apply to code, not to comments that describe forbidden things.
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const hook = strip(await read("../../hooks/useCartLineActions.ts"));
const cartScreen = strip(await read("../../app/cart.tsx"));
const cartSheet = strip(await read("../CartSheet.tsx"));
const lineItem = strip(await read("./CartLineItem.tsx"));
const reservation = strip(await read("./ReservationStatus.tsx"));
const expiryNotice = strip(await read("./ReservationExpiryNotice.tsx"));
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
  assert.match(hook, /if \(failureNeedsReconcile\(kind\)\) \{\s*reportUnconfirmed\(\);/);
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
  assert.doesNotMatch(expiryNotice, /clearCart|refreshCart|removeItem|addItem|updateItem|router\./, "the expiry notice only observes");
  assert.match(expiryNotice, /reservationJustExpired\(previousRef\.current, next\)/);
  assert.match(layout, /<ReservationExpiryNotice \/>/);
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
  assert.match(holdersScreen, /if \(!ticketSlots\.length\) router\.replace\("\/cart"\);/);
  assert.match(holdersScreen, /initializeFirstHolder\(firstSlot\.key, profileName\)/);
  assert.match(holdersScreen, /aria-invalid=\{showError\}/);
  assert.match(holdersScreen, /accessibilityLabel=\{i18n\.t\("holders\.field\.a11y", \{ ticket: slot\.label \}\)\}/);
  // Names stay in the existing owner.
  assert.doesNotMatch(holdersScreen, /useState<Record<string, string>>|storage\./);
});

test("checkout readiness includes expiry, the payload builder is shared, and nothing clears the cart", () => {
  assert.match(checkout, /const readiness = checkoutReadiness\(\{\s*itemCount: cart\.items\.length,\s*secondsLeft: cart\.secondsLeft,/);
  assert.match(checkout, /const canContinue = readiness\.ready;/);
  assert.equal((checkout.match(/buildTicketsByMatch\(ticketSlots, holderNames\)/g) ?? []).length, 2, "BLUE and card use the same payload");
  assert.doesNotMatch(checkout, /clearCart/);
  assert.match(checkout, /busy: loading/);
  assert.match(checkout, /disabled: !canContinue/);
});

test("payment methods are exactly the supported ones, with radio semantics", () => {
  assert.deepEqual(methods.match(/id: "(\w+)"/g), ['id: "cybersource"', 'id: "blue"']);
  assert.match(methods, /accessibilityRole="radiogroup"/);
  assert.match(methods, /accessibilityRole="radio"/);
  assert.match(methods, /aria-checked=\{active\}/);
});

test("submit failures use catalog copy, and unknown outcomes are never shown as failed", () => {
  const submitBlue = section(checkout, "const submitBlue = async", "const readiness = checkoutReadiness");
  const blueCatch = section(submitBlue, "} catch (err) {", "} finally {");
  assert.doesNotMatch(blueCatch, /userFacingError|err\.message/);
  assert.match(blueCatch, /paymentFailureKind\(errorFacts\(err\)\)/);
  assert.match(blueCatch, /i18n\.t\("checkout\.submitFailed\.unknown"\)/);
  const cardCatch = section(card, "} catch (submissionError) {", "} finally {");
  assert.doesNotMatch(cardCatch, /userFacingError|submissionError\.message/);
  assert.match(cardCatch, /paymentFailureKind\(errorFacts\(submissionError\)\)/);
  assert.match(card, /failure\?\.kind === "unknown" \|\| failure\?\.kind === "locked"\s*\? \{ label: i18n\.t\("payment\.viewTickets"\)/);
});

test("an unknown payment outcome locks that session's payment on both methods", () => {
  const submitBlue = section(checkout, "const submitBlue = async", "const reconciliationRequired =");
  const blueCatch = section(submitBlue, "} catch (err) {", "} finally {");
  // Locked for the attempt's own session, even if Checkout is no longer mounted.
  assert.match(blueCatch, /if \(cart\.isCartSessionCurrent\(cartSessionTicket\)\) \{\s*if \(failure === "unknown"\) markPaymentOutcomeUnknown\(submissionTicket\.sessionId, "blue"\);\s*else if \(attempt\) void settlePaymentAttempt\(submissionTicket\.sessionId, attempt\.id\);/);
  const cardCatch = section(card, "} catch (submissionError) {", "} finally {");
  assert.match(cardCatch, /if \(kind === "unknown"\) markPaymentOutcomeUnknown\(cartTicket\.sessionId as string, "card"\);\s*else if \(attempt\) void settlePaymentAttempt\(sessionId, attempt\.id\);/);
  assert.ok(cardCatch.indexOf("markPaymentOutcomeUnknown(") < cardCatch.indexOf("if (!activeRef.current) return;"), "the lock does not depend on the screen still being mounted");
  // The card screen refuses to submit (and opens locked) for a changed,
  // expired, gated or locked session, from the owner's current state.
  const block = section(card, "const submitBlock = useCallback(", "const handleSuccess = useCallback(");
  assert.match(block, /const owner = cart\.readCartGuardState\(\);/);
  assert.match(block, /paymentOutcomeUnknown: readPaymentOutcomeLock\(sessionId\) !== null/);
  assert.match(block, /paymentAttemptInProgress: isPaymentAttemptHeldByOther\(sessionId, own\)/);
  const handle = section(card, "const handleSuccess = useCallback(", "submittingRef.current = true;");
  assert.match(handle, /const blockedAtToken = submitBlock\(sessionId, null\);\s*if \(blockedAtToken\) \{\s*setFailure\(blockedAtToken\);\s*return;\s*\}/);
  assert.match(card, /: readPaymentOutcomeLock\(handoff\.sessionId\)\s*\? \{ kind: "locked" \}/);
  // BLUE's already-known pending URL behaviour is preserved.
  assert.match(checkout, /readPendingBluePaymentAttempt\(\s*cartSessionTicket\.sessionId as string,?\s*\)/);
});

test("both methods record the attempt, then re-check the owner, immediately before the submit", () => {
  const cardAttempt = section(card, "submittingRef.current = true;", "} catch (submissionError) {");
  const blueAttempt = section(section(checkout, "const submitBlue = async", "const reconciliationRequired ="), "const submissionTicket = checkoutSubmissionAuthority.begin(", "} catch (err) {");
  for (const [name, source, record, recheck] of [
    ["card", cardAttempt, 'await acquirePaymentAttempt(sessionId, "card")', "submitBlock(sessionId, attempt)"],
    ["blue", blueAttempt, 'await acquirePaymentAttempt(submissionTicket.sessionId, "blue")', "cart.readCartGuardState()"],
  ]) {
    const order = [record, recheck, "settlePaymentAttempt(", "await checkoutService.submit("];
    let last = -1;
    for (const marker of order) {
      const index = source.indexOf(marker);
      assert.ok(index > last, `${name}: ${marker}`);
      last = index;
    }
    // Nothing between the re-check and the submit can await (no expiry window).
    const tail = source.slice(source.indexOf(recheck), source.indexOf("await checkoutService.submit("));
    assert.equal((tail.match(/await /g) ?? []).length, 1, `${name}: only the settle of a blocked attempt awaits`);
    assert.match(tail, /return;\s*\}\s*(const response = )?$/m, `${name}: a blocked attempt returns before submitting`);
  }
  assert.match(blueAttempt, /paymentSubmitBlocker\(\{/);
  assert.match(card, /case "expired":\s*return i18n\.t\("payment\.reservationGone"\);/);
});

test("one shared attempt gate: each surface passes only its own acquisition identity", () => {
  // Final guards pass the surface's own attempt, never null, right before the submit.
  assert.match(checkout, /paymentAttemptInProgress: isPaymentAttemptHeldByOther\(submissionTicket\.sessionId, attempt\)/);
  assert.match(card, /const blockedBeforeSubmit = submitBlock\(sessionId, attempt\)/);
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
  const success = section(card, "const response = await checkoutService.submit", "} catch (submissionError)");
  const order = ["cart.isCartSessionCurrent(cartTicket)", "await cart.clearCartIfSession(cartTicket)", 'pathname: "/checkout/success"'];
  let last = -1;
  for (const marker of order) {
    const index = success.indexOf(marker);
    assert.ok(index > last, marker);
    last = index;
  }
  // An accepted submit this screen can no longer reconcile locks the session instead of being dropped.
  assert.match(success, /if \(!activeRef\.current\) \{\s*markPaymentOutcomeUnknown\(sessionId, "card"\);\s*return;\s*\}/);
  assert.ok(success.indexOf("markPaymentOutcomeUnknown(") < success.indexOf("await cart.clearCartIfSession(cartTicket)"));
  // Hardware and header back share one synchronous (ref) guard; the header is also visibly disabled.
  assert.match(card, /if \(canLeavePayment\(submittingRef\)\) returnToCheckout\(\);\s*return true;/, "hardware back");
  assert.match(card, /onBack=\{\(\) => \{\s*if \(canLeavePayment\(submittingRef\)\) returnToCheckout\(\);\s*\}\}/, "header back");
  assert.match(card, /backDisabled=\{processing\}/);
  assert.doesNotMatch(card, /onBack=\{processing \?/, "no render-state-only guard");
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

test("AppHeader's optional backDisabled makes back inert and announced; other callers are unaffected", async () => {
  const header = strip(await read("../AppHeader.tsx"));
  assert.match(header, /backDisabled = false,/);
  assert.match(header, /const handleBack = \(\) => \{\s*if \(backDisabled\) return;/);
  assert.match(header, /disabled=\{backDisabled\}/);
  assert.match(header, /aria-disabled=\{backDisabled\}/);
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
  assert.match(handle, /if \(paymentMethod === "cybersource"\) \{[\s\S]*?pathname: "\/checkout\/card\/payment"/);
  assert.match(handle, /void submitBlue\(\);/);
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

test("expiry and result copy never claim that no payment or order exists", async () => {
  const { en } = await import("../../i18n/messages/en.ts");
  for (const key of ["cart.expiredNotice.title", "cart.expiredNotice.message", "cart.expired.title", "cart.expired.message", "result.failed.message"]) {
    assert.doesNotMatch(en[key], /no payment was taken|no order was created|not charged/i, key);
  }
});
