import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reservationIndicatorAllowedOn, shouldShowReservationIndicator } from "./reservationIndicator.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const active = { pathname: "/", sessionId: "s-1", itemCount: 2, secondsLeft: 420, onboardingVisible: false };

test("shown only while the cart owner reports an active reservation", () => {
  assert.equal(shouldShowReservationIndicator(active), true);
  assert.equal(shouldShowReservationIndicator({ ...active, sessionId: null }), false);
  assert.equal(shouldShowReservationIndicator({ ...active, itemCount: 0 }), false);
  // At zero the owner expires the session; the indicator never outlives it.
  assert.equal(shouldShowReservationIndicator({ ...active, secondsLeft: 0 }), false);
  assert.equal(shouldShowReservationIndicator({ ...active, onboardingVisible: true }), false);
});

test("appears on normal screens and stays off screens that own a countdown or a transaction", () => {
  for (const pathname of ["/", "/matches", "/tickets", "/competitions", "/profile", "/settings", "/about", "/edit-profile", "/auth"]) {
    assert.equal(reservationIndicatorAllowedOn(pathname), true, pathname);
  }
  for (const pathname of [
    "/cart",
    "/checkout",
    "/checkout/ticket-holders",
    "/checkout/card/payment",
    "/checkout/blue/payment",
    "/checkout/success",
    "/checkout/failed",
    "/checkout/blue/success",
    "/match/42",
  ]) {
    assert.equal(reservationIndicatorAllowedOn(pathname), false, pathname);
  }
});

test("the indicator is presentation only: one expiry authority (CartContext)", async () => {
  const bar = strip(await read("../components/cart/ReservationHoldBar.tsx"));
  const chrome = strip(await read("../components/AppChrome.tsx"));
  // No second clock, timestamp or reservation state.
  for (const source of [bar, chrome]) {
    assert.doesNotMatch(source, /Date\.now|new Date|expires_?at|expiresAt|setInterval|clearCart|removeItem|refreshCart|storage\./i);
  }
  assert.match(chrome, /secondsLeft: cart\.secondsLeft/);
  assert.match(chrome, /<ReservationHoldBar secondsLeft=\{cart\.secondsLeft\}/);
  assert.doesNotMatch(bar, /useCart/);
  // Opens the existing cart experience.
  assert.match(chrome, /router\.navigate\("\/cart"\)/);
  // Expiry explanation stays with the single existing notice.
  const layout = strip(await read("../app/_layout.tsx"));
  assert.equal(layout.match(/<ReservationExpiryNotice \/>/g)?.length, 1);
  assert.doesNotMatch(bar + chrome, /no payment was taken/i);
});

test("the bar sits in the layout flow (never over content) and screens below do not pad for the status bar twice", async () => {
  const bar = strip(await read("../components/cart/ReservationHoldBar.tsx"));
  const chrome = strip(await read("../components/AppChrome.tsx"));
  assert.doesNotMatch(bar, /position: "absolute" as const, (top|bottom)/);
  assert.match(bar, /paddingTop: topInset/);
  assert.match(chrome, /const contentInsets = useMemo\(\(\) => \(showHold \? \{ \.\.\.insets, top: 0 \} : insets\), \[insets, showHold\]\);/);
  assert.match(chrome, /<SafeAreaInsetsContext\.Provider value=\{contentInsets\}>\{children\}<\/SafeAreaInsetsContext\.Provider>/);
});

test("accessible, not chatty: one labelled button, no per-second announcements, reduced-motion pulse", async () => {
  const bar = strip(await read("../components/cart/ReservationHoldBar.tsx"));
  assert.match(bar, /accessibilityRole="button"/);
  assert.match(bar, /accessibilityLabel=\{i18n\.t\("reservation\.indicator\.a11y", \{ minutes, seconds \}\)\}/);
  assert.match(bar, /accessibilityHint=\{i18n\.t\("reservation\.indicator\.hint"\)\}/);
  assert.doesNotMatch(bar, /announceForAccessibility|accessibilityLiveRegion|aria-live/);
  assert.match(bar, /if \(reducedMotion\) \{\s*pulse\.setValue\(0\);\s*return;/);
  assert.match(bar, /minHeight: RESERVATION_HOLD_BAR_HEIGHT/);
});

test("header actions no longer repeat the countdown", async () => {
  const actions = strip(await read("../components/HeaderActions.tsx"));
  assert.doesNotMatch(actions, /CartTimerPill|secondsLeft/);
  assert.match(actions, /accessibilityRole="button"/);
});
