import assert from "node:assert/strict";
import test from "node:test";
import { getSeatAccessibility, getSeatIdentity } from "./seatAccessibility.ts";

test("identity prefers an explicit meaningful label", () => {
  assert.equal(getSeatIdentity({ label: "A-12", row: "A", number: "12" }), "A-12");
});

test("identity uses row and seat number when no label exists", () => {
  assert.equal(getSeatIdentity({ row: "A", number: "12" }), "Row A, Seat 12");
});

test("identity uses seat number alone", () => {
  assert.equal(getSeatIdentity({ number: "12" }), "Seat 12");
});

test("identity uses row alone", () => {
  assert.equal(getSeatIdentity({ row: "A" }), "Row A");
});

test("identity uses a generic fallback when fields are absent", () => {
  assert.equal(getSeatIdentity({}), "Seat");
});

test("identity ignores empty strings", () => {
  assert.equal(getSeatIdentity({ label: " ", row: "", number: "  " }), "Seat");
});

test("identity accepts finite numeric metadata including zero", () => {
  assert.equal(getSeatIdentity({ label: 0 }), "0");
  assert.equal(getSeatIdentity({ row: 3, number: 7 }), "Row 3, Seat 7");
});

test("identity safely rejects malformed non-display values", () => {
  const values = [{}, [], true, false, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined];
  for (const value of values) {
    assert.equal(getSeatIdentity({ label: value }), "Seat");
  }
});

test("identity falls through mixed invalid and valid metadata", () => {
  assert.equal(getSeatIdentity({ label: {}, row: "A", number: 12 }), "Row A, Seat 12");
  assert.equal(getSeatIdentity({ label: [], row: null, number: null }), "Seat");
});

test("explicit label prevents duplicate row and number fragments", () => {
  assert.equal(getSeatIdentity({ label: "Row A, Seat 12", row: "A", number: "12" }), "Row A, Seat 12");
});

test("available seat exposes available state and selection hint", () => {
  assert.deepEqual(
    getSeatAccessibility({
      seat: { row: "A", number: "12", status: "available" },
      zoneName: "VIP",
      selected: false,
      inCart: false,
    }),
    {
      identity: "Row A, Seat 12",
      state: "available",
      label: "VIP, Row A, Seat 12, available",
      hint: "Selects this seat.",
      selected: false,
      disabled: false,
    },
  );
});

test("selected seat exposes selected state and removal hint", () => {
  const result = getSeatAccessibility({
    seat: { row: "A", number: "12", status: "available" },
    zoneName: "VIP",
    selected: true,
    inCart: false,
  });
  assert.equal(result.label, "VIP, Row A, Seat 12, selected");
  assert.equal(result.hint, "Removes this seat from your selection.");
  assert.equal(result.selected, true);
  assert.equal(result.disabled, false);
});

test("seat in cart is disabled, not selected, and has no action hint", () => {
  const result = getSeatAccessibility({
    seat: { label: "A-12", status: "available" },
    zoneName: "VIP",
    selected: true,
    inCart: true,
  });
  assert.equal(result.label, "VIP, A-12, in cart");
  assert.equal(result.state, "in cart");
  assert.equal(result.hint, undefined);
  assert.equal(result.selected, false);
  assert.equal(result.disabled, true);
});

for (const status of ["reserved", "booked", "locked", "sold", "maintenance"]) {
  test(`${status} seat maps to bounded unavailable state`, () => {
    const result = getSeatAccessibility({
      seat: { row: "B", number: "4", status },
      zoneName: "East",
      selected: false,
      inCart: false,
    });
    assert.equal(result.label, "East, Row B, Seat 4, unavailable");
    assert.equal(result.state, "unavailable");
    assert.equal(result.selected, false);
    assert.equal(result.disabled, true);
    assert.equal(result.hint, undefined);
  });
}

test("zone is omitted cleanly when unavailable", () => {
  const result = getSeatAccessibility({
    seat: { number: "8", status: "available" },
    zoneName: " ",
    selected: false,
    inCart: false,
  });
  assert.equal(result.label, "Seat 8, available");
});

test("accessibility label uses normalized numeric metadata without exposing objects", () => {
  const result = getSeatAccessibility({
    seat: { label: {}, row: 3, number: 0, status: "available" },
    zoneName: "VIP",
    selected: false,
    inCart: false,
  });
  assert.equal(result.label, "VIP, Row 3, Seat 0, available");
  assert.equal(result.label.includes("[object Object]"), false);
});
