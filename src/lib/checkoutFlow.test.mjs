import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTicketsByMatch,
  checkoutReadiness,
  groupHolderSlots,
  holderCompleteness,
  isHolderNameValid,
  paymentFailureKind,
} from "./checkoutFlow.ts";
import { deriveTicketSlots } from "./ticketHolders.ts";

const items = [
  { lock_key: "g1", match_id: 7, stadium_zone_id: 1, type: "zone", quantity: 2, zone_name: "Zone A", match_title: "Ansar vs Mabarrah", unit_price: 6, currency: "USD", subtotal: 12 },
  { lock_key: "s1", match_id: 7, stadium_zone_id: 2, type: "seats", quantity: 1, zone_name: "VIP", match_title: "Ansar vs Mabarrah", seats: [{ id: "91", row: "A", number: "4" }], unit_price: 70, currency: "USD", subtotal: 70 },
  { lock_key: "g2", match_id: 8, stadium_zone_id: 1, type: "zone", quantity: 1, zone_name: "Zone A", match_title: "Ansar vs Juwaya", unit_price: 6, currency: "USD", subtotal: 6 },
];
const slots = deriveTicketSlots(items);

/** The exact reducer Checkout used before Phase 4 (both BLUE and card paths). */
function legacyTicketsByMatch(ticketSlots, holderNames) {
  return ticketSlots.reduce((acc, slot) => {
    acc[slot.matchId] = [...(acc[slot.matchId] ?? []), { holder_name: holderNames[slot.key].trim() }];
    return acc;
  }, {});
}

test("the checkout payload is unchanged: same keys, order, trimming and grouping", () => {
  const names = Object.fromEntries(slots.map((slot, index) => [slot.key, `  Holder ${index + 1} `]));
  assert.deepEqual(buildTicketsByMatch(slots, names), legacyTicketsByMatch(slots, names));
  assert.deepEqual(buildTicketsByMatch(slots, names), {
    7: [{ holder_name: "Holder 1" }, { holder_name: "Holder 2" }, { holder_name: "Holder 3" }],
    8: [{ holder_name: "Holder 4" }],
  });
});

test("holder validity is the existing rule: a non-blank name", () => {
  assert.equal(isHolderNameValid("Nour"), true);
  assert.equal(isHolderNameValid("   "), false);
  assert.equal(isHolderNameValid(""), false);
  assert.equal(isHolderNameValid(undefined), false);
});

test("completeness reports progress and the first field to focus", () => {
  const names = { [slots[0].key]: "Nour", [slots[1].key]: " ", [slots[3].key]: "Sam" };
  const result = holderCompleteness(slots, names);
  assert.equal(result.total, 4);
  assert.equal(result.complete, 2);
  assert.deepEqual(result.missingKeys, [slots[1].key, slots[2].key]);
  assert.equal(result.firstIncompleteKey, slots[1].key);
  assert.equal(result.allComplete, false);
  const all = Object.fromEntries(slots.map((slot) => [slot.key, "X"]));
  assert.equal(holderCompleteness(slots, all).allComplete, true);
  assert.equal(holderCompleteness(slots, all).firstIncompleteKey, null);
  assert.equal(holderCompleteness([], {}).allComplete, false, "no tickets is never complete");
});

test("holder fields are grouped by match then zone, keeping each ticket's position and seat association", () => {
  const groups = groupHolderSlots(slots);
  assert.deepEqual(groups.map((group) => group.matchId), ["7", "8"]);
  assert.deepEqual(groups[0].zones.map((zone) => zone.zoneName), ["Zone A", "VIP"]);
  assert.deepEqual(groups[0].zones[1].entries.map(({ slot, index }) => [slot.key, index]), [["s1_seat_91", 2]]);
  assert.equal(groups[1].zones[0].entries[0].index, 3);
  // Every slot appears exactly once.
  assert.equal(groups.flatMap((group) => group.zones.flatMap((zone) => zone.entries)).length, slots.length);
});

test("checkout readiness keeps every existing prerequisite and adds the owner's expiry", () => {
  const ready = {
    itemCount: 3,
    secondsLeft: 300,
    locked: false,
    holdersComplete: true,
    paymentMethod: "blue",
    profileComplete: true,
    phoneValid: true,
  };
  assert.deepEqual(checkoutReadiness(ready), { ready: true, blocker: null });
  for (const [change, blocker] of [
    [{ itemCount: 0 }, "noItems"],
    [{ secondsLeft: 0 }, "expired"],
    [{ locked: true }, "busy"],
    [{ holdersComplete: false }, "holders"],
    [{ paymentMethod: null }, "method"],
    [{ profileComplete: false }, "profile"],
    [{ phoneValid: false }, "phone"],
  ]) {
    assert.deepEqual(checkoutReadiness({ ...ready, ...change }), { ready: false, blocker }, blocker);
  }
});

test("a payment submit that never got a definite answer is never reported as not completed", () => {
  assert.equal(paymentFailureKind({ status: null, transport: "timeout" }), "unknown");
  assert.equal(paymentFailureKind({ status: null, transport: "network" }), "unknown");
  assert.equal(paymentFailureKind({ status: 500, transport: null }), "unknown");
  assert.equal(paymentFailureKind({ status: null, transport: null }), "unknown");
  assert.equal(paymentFailureKind({ status: 422, transport: null }), "notCompleted");
  assert.equal(paymentFailureKind({ status: 402, transport: null }), "notCompleted");
  assert.equal(paymentFailureKind({ status: 401, transport: null }), "session");
  assert.equal(paymentFailureKind({ status: 503, transport: null }), "maintenance");
});
