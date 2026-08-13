import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileSource = await readFile(
  new URL("../app/profile.tsx", import.meta.url),
  "utf8",
);

function occurrenceCount(pattern) {
  return profileSource.match(pattern)?.length ?? 0;
}

test("profile totals are owner-gated and used by both summary and section counts", () => {
  assert.match(
    profileSource,
    /const visibleOrdersTotal\s*=\s*renderedOwnerKey === activeOwnerKey \? ordersTotal : 0;/,
  );
  assert.match(
    profileSource,
    /const visibleTicketsTotal\s*=\s*renderedOwnerKey === activeOwnerKey \? ticketsTotal : 0;/,
  );

  assert.equal(occurrenceCount(/\{visibleOrdersTotal\}/g), 2);
  assert.equal(occurrenceCount(/\{visibleTicketsTotal\}/g), 2);
});

test("ticket list uses confirmed order and match helpers", () => {
  assert.match(
    profileSource,
    /const ticketMatchName = getTicketMatchName\(ticket\);/,
  );
  assert.match(
    profileSource,
    /const ticketOrderReference = getTicketOrderReference\(ticket\);/,
  );
  assert.match(
    profileSource,
    /Match:\s*\{ticketMatchName \?\? "Unavailable"\}/,
  );
  assert.match(
    profileSource,
    /Order:\s*\{ticketOrderReference \?\? "Unavailable"\}/,
  );
});

test("ticket detail uses the same order and match helpers", () => {
  assert.ok(
    occurrenceCount(/getTicketMatchName\(/g) >= 2,
    "Expected match-name helper usage in both ticket list and detail.",
  );
  assert.ok(
    occurrenceCount(/getTicketOrderReference\(/g) >= 2,
    "Expected order-reference helper usage in both ticket list and detail.",
  );
  assert.match(
    profileSource,
    /detail\?\.type === "ticket" && ticketOrderReference/,
  );
  assert.match(
    profileSource,
    /detail\?\.type === "ticket" && ticketMatchName/,
  );
});

test("ticket detail keeps the nested match card for fields such as stadium", () => {
  assert.match(
    profileSource,
    /const entries = normalized\s*\? Object\.entries\(normalized\)\.filter\(\(\[key, value\]\) =>\s*shouldShowDetailField\(key, value\)\s*\)\s*: \[\];/,
  );
  assert.doesNotMatch(
    profileSource,
    /detail\?\.type !== "ticket" \|\| key !== ["']match["']/,
  );
});

test("ticket list retains its ten-row presentation limit", () => {
  assert.match(profileSource, /visibleTickets\.slice\(0,\s*10\)/);
});
