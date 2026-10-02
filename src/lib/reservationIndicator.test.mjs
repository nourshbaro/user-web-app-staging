import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reservationIndicatorAllowedOn, reservationIndicatorInteractive, shouldShowReservationIndicator } from "./reservationIndicator.ts";

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
  // v3: Match Details, ticket holders and Checkout use this indicator as their one countdown.
  for (const pathname of ["/", "/matches", "/tickets", "/competitions", "/profile", "/settings", "/about", "/edit-profile", "/auth", "/match/42", "/checkout/ticket-holders", "/checkout", "/checkout/card/payment", "/checkout/blue/payment"]) {
    assert.equal(reservationIndicatorAllowedOn(pathname), true, pathname);
  }
  // Cart has its own countdown card (same owner value); the result screens stay free of it.
  for (const pathname of [
    "/cart",
    "/checkout/success",
    "/checkout/failed",
    "/checkout/blue/success",
    "/checkout/blue/failed",
  ]) {
    assert.equal(reservationIndicatorAllowedOn(pathname), false, pathname);
  }
});

test("inside the checkout flow the indicator is read-only (no jump to Cart mid-submission)", async () => {
  assert.equal(reservationIndicatorInteractive("/match/42"), true);
  assert.equal(reservationIndicatorInteractive("/"), true);
  assert.equal(reservationIndicatorInteractive("/checkout"), false);
  assert.equal(reservationIndicatorInteractive("/checkout/ticket-holders"), false);
  const chrome = strip(await read("../components/AppChrome.tsx"));
  assert.match(chrome, /onPress=\{reservationIndicatorInteractive\(pathname\) \? openCart : undefined\}/);
  const bar = strip(await read("../components/cart/ReservationHoldBar.tsx"));
  assert.match(bar, /\{onPress \? \(\s*<Pressable/);
  assert.match(bar, /accessibilityRole="timer"/);
});

test("one countdown surface per screen, all derived from CartContext.secondsLeft", async () => {
  const match = strip(await read("../app/match/[id].tsx"));
  const holders = strip(await read("../app/checkout/ticket-holders.tsx"));
  const checkout = strip(await read("../app/checkout.tsx"));
  const cart = strip(await read("../app/cart.tsx"));
  // Screens that rely on the global indicator show no second timer of their own.
  for (const [name, source] of [["match", match], ["holders", holders], ["checkout", checkout]]) {
    assert.doesNotMatch(source, /showTimer|CartTimerPill|<ReservationStatus|<CartTimer/, name);
  }
  // Cart shows exactly one countdown, from the owner's value.
  assert.equal(cart.match(/<ReservationStatus secondsLeft=\{cart\.secondsLeft\}/g)?.length, 1);
  for (const source of [match, holders, checkout, cart]) {
    assert.doesNotMatch(source, /expires_?at|expiresAt|setInterval/);
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
  // Expiry is explained once, by the v3 sheet mounted in the chrome (never by the bar).
  assert.equal(chrome.match(/<HoldExpiredSheet \/>/g)?.length, 1);
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

test("one redesigned countdown everywhere: the payment screens show the global bar and draw no timer of their own", async () => {
  const { readdir } = await import("node:fs/promises");
  const components = await readdir(new URL("../components/", import.meta.url));
  // The legacy timer pill and the header that carried it are gone.
  assert.equal(components.includes("CartTimer.tsx"), false);
  assert.equal(components.includes("AppHeader.tsx"), false);
  for (const path of ["../components/CardPaymentScreen.tsx", "../components/BluePaymentScreen.native.tsx"]) {
    const source = strip(await read(path));
    assert.doesNotMatch(source, /secondsLeft|showTimer|CartTimer|minutesSeconds|setInterval/, path);
  }
  // The bar is allowed on the payment routes (read-only there) and still hidden on Cart and the results.
  assert.equal(shouldShowReservationIndicator({ pathname: "/checkout/card/payment", sessionId: "S", itemCount: 1, secondsLeft: 300, onboardingVisible: false }), true);
  assert.equal(shouldShowReservationIndicator({ pathname: "/checkout/blue/payment", sessionId: "S", itemCount: 1, secondsLeft: 300, onboardingVisible: false }), true);
  assert.equal(reservationIndicatorInteractive("/checkout/card/payment"), false);
  assert.equal(shouldShowReservationIndicator({ pathname: "/cart", sessionId: "S", itemCount: 1, secondsLeft: 300, onboardingVisible: false }), false);
  assert.equal(shouldShowReservationIndicator({ pathname: "/checkout/success", sessionId: "S", itemCount: 1, secondsLeft: 300, onboardingVisible: false }), false);
});
