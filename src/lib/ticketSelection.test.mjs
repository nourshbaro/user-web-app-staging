import assert from "node:assert/strict";
import test from "node:test";
import {
  SEAT_ZOOM_LEVELS,
  gaCartChanges,
  hasSelectionChanges,
  isSeatSelectable,
  lineSubtotal,
  orderedSelectedSeats,
  resolveDraftQuantity,
  seatVisualState,
  selectionActionKind,
  selectionEstimate,
  stepSeatZoom,
  ticketErrorKind,
  toggleDraftSeat,
} from "./ticketSelection.ts";

const line = (quantity, lockKey = `lock-${quantity}`, seatCount = 0) => ({ quantity, lockKey, seatCount });

test("an untouched GA draft mirrors the committed cart quantity; a touched one wins", () => {
  const cart = new Map([[1, line(2, "a")]]);
  assert.equal(resolveDraftQuantity(new Map(), cart, 1), 2);
  assert.equal(resolveDraftQuantity(new Map(), cart, 9), 0);
  assert.equal(resolveDraftQuantity(new Map([[1, 0]]), cart, 1), 0, "an explicit zero draft is kept, not replaced by the cart");
  assert.equal(resolveDraftQuantity(new Map([[1, 5]]), cart, 1), 5);
});

test("GA commit plan: unchanged zones send nothing; add / set / remove follow the established semantics", () => {
  const zones = [
    { id: 1, has_seats: false }, // unchanged
    { id: 2, has_seats: false }, // new line
    { id: 3, has_seats: false }, // set 2 -> 4 (never additive)
    { id: 4, has_seats: false }, // removed
    { id: 5, has_seats: true }, // reserved: never part of the GA plan
    { id: 6, has_seats: false }, // untouched, nothing in cart
  ];
  const cart = new Map([
    [1, line(3, "l1")],
    [3, line(2, "l3")],
    [4, line(1, "l4")],
    [5, line(0, "l5", 2)],
  ]);
  const drafts = new Map([[2, 2], [3, 4], [4, 0], [5, 9]]);
  const changes = gaCartChanges(zones, (id) => resolveDraftQuantity(drafts, cart, id), cart);
  assert.deepEqual(changes, [
    { zoneId: 2, action: "add", from: 0, to: 2 },
    { zoneId: 3, action: "update", from: 2, to: 4, lockKey: "l3" },
    { zoneId: 4, action: "remove", from: 1, to: 0, lockKey: "l4" },
  ]);
  assert.equal(selectionActionKind(changes), "update");
  assert.equal(selectionActionKind(changes.slice(0, 1)), "add");
});

test("a zone whose cart line reports zero is added, not updated", () => {
  const cart = new Map([[7, line(0, "stale")]]);
  assert.deepEqual(gaCartChanges([{ id: 7, has_seats: false }], () => 3, cart), [
    { zoneId: 7, action: "add", from: 0, to: 3 },
  ]);
});

test("the confirmation is available for removals and pending seats, and not when the draft equals the cart", () => {
  const cart = new Map([[1, line(2, "a")]]);
  const zones = [{ id: 1, has_seats: false }];
  const same = gaCartChanges(zones, () => 2, cart);
  const removal = gaCartChanges(zones, () => 0, cart);
  assert.equal(hasSelectionChanges(same, 0), false);
  assert.equal(hasSelectionChanges(removal, 0), true, "setting an existing line to zero must be committable");
  assert.equal(hasSelectionChanges(same, 1), true);
});

test("estimate is display-only: invalid prices and mixed currencies never produce a guessed amount", () => {
  assert.deepEqual(
    selectionEstimate([
      { quantity: 2, unitPrice: "25.50", currency: "USD" },
      { quantity: 1, unitPrice: 10, currency: "USD" },
      { quantity: 0, unitPrice: "abc", currency: "EUR" },
    ]),
    { tickets: 3, amount: 61, currency: "USD", mixedCurrency: false },
  );
  assert.equal(selectionEstimate([{ quantity: 1, unitPrice: "", currency: "USD" }]).amount, null);
  assert.equal(selectionEstimate([{ quantity: 1, unitPrice: null, currency: "USD" }]).amount, null);
  const mixed = selectionEstimate([
    { quantity: 1, unitPrice: 5, currency: "USD" },
    { quantity: 1, unitPrice: 5, currency: "LBP" },
  ]);
  assert.equal(mixed.mixedCurrency, true);
  assert.equal(mixed.amount, null);
  assert.deepEqual(selectionEstimate([]), { tickets: 0, amount: null, currency: null, mixedCurrency: false });
  assert.equal(lineSubtotal(3, "12.5"), 37.5);
  assert.equal(lineSubtotal(3, "n/a"), null);
});

test("seat states follow backend availability, with cart seats taking precedence", () => {
  const cartSeatIds = new Set([3]);
  assert.equal(seatVisualState({ id: 1, status: "available" }, [], cartSeatIds), "available");
  assert.equal(seatVisualState({ id: 1, status: "available" }, [1], cartSeatIds), "selected");
  assert.equal(seatVisualState({ id: 3, status: "reserved" }, [3], cartSeatIds), "inCart");
  for (const status of ["reserved", "booked", "locked", "sold", "", undefined, "AVAILABLE"]) {
    assert.equal(seatVisualState({ id: 2, status }, [2], cartSeatIds), "unavailable", `status ${status}`);
    assert.equal(isSeatSelectable({ id: 2, status }, cartSeatIds), false);
  }
  assert.equal(isSeatSelectable({ id: 3, status: "available" }, cartSeatIds), false, "a seat already in the cart is not selectable");
});

test("toggling seats: unavailable and cart seats are ignored; another zone's draft is discarded", () => {
  const cart = new Set([9]);
  assert.equal(toggleDraftSeat([1], { id: 2, status: "sold" }, true, cart), null);
  assert.equal(toggleDraftSeat([1], { id: 9, status: "available" }, true, cart), null);
  assert.deepEqual(toggleDraftSeat([1], { id: 2, status: "available" }, true, cart), [1, 2]);
  assert.deepEqual(toggleDraftSeat([1, 2], { id: 1, status: "available" }, true, cart), [2]);
  assert.deepEqual(toggleDraftSeat([1, 2], { id: 5, status: "available" }, false, cart), [5], "stale draft from another zone is dropped");
  assert.deepEqual(toggleDraftSeat([1, 9], { id: 5, status: "available" }, true, cart), [1, 5], "seats that reached the cart leave the draft");
});

test("the seat summary uses only loaded backend seats, in selection order", () => {
  const seats = [
    { id: 1, row: "A", number: "1" },
    { id: 2, row: "A", number: "2" },
    { id: 3, row: "B", number: "1" },
  ];
  assert.deepEqual(orderedSelectedSeats(seats, [3, 1, 99]).map((seat) => seat.id), [3, 1]);
});

test("seat zoom steps within fixed levels", () => {
  assert.equal(stepSeatZoom(1, -1), 1);
  assert.equal(stepSeatZoom(1, 1), 1.5);
  assert.equal(stepSeatZoom(1.5, 1), 2);
  assert.equal(stepSeatZoom(2, 1), 2);
  assert.equal(stepSeatZoom(7, 1), SEAT_ZOOM_LEVELS[1], "an unknown level restarts from the first");
});

test("errors are classified from transport and HTTP status only", () => {
  const facts = (status, transport = null) => ({ status, transport });
  assert.equal(ticketErrorKind("cart", facts(null, "network")), "offline");
  assert.equal(ticketErrorKind("seats", facts(null, "timeout")), "timeout");
  assert.equal(ticketErrorKind("cart", facts(401)), "session");
  assert.equal(ticketErrorKind("match", facts(404)), "notFound");
  assert.equal(ticketErrorKind("cart", facts(404)), "expired");
  assert.equal(ticketErrorKind("cart", facts(410)), "expired");
  assert.equal(ticketErrorKind("cart", facts(409)), "unavailable");
  assert.equal(ticketErrorKind("cart", facts(422)), "rejected");
  assert.equal(ticketErrorKind("match", facts(503)), "maintenance");
  assert.equal(ticketErrorKind("match", facts(500)), "generic");
  assert.equal(ticketErrorKind("seats", facts(null)), "generic");
});
