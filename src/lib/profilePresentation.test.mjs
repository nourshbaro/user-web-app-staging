import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileSource = await readFile(
  new URL("../app/profile.tsx", import.meta.url),
  "utf8",
);

const profileDetailSource = await readFile(
  new URL("../components/ProfileDetailModal.tsx", import.meta.url),
  "utf8",
);

function occurrenceCount(source, pattern) {
  return source.match(pattern)?.length ?? 0;
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

  assert.equal(
    occurrenceCount(profileSource, /\{visibleOrdersTotal\}/g),
    2,
  );
  assert.equal(
    occurrenceCount(profileSource, /\{visibleTicketsTotal\}/g),
    2,
  );
});

test("profile route imports and renders the extracted detail modal", () => {
  assert.match(
    profileSource,
    /import\s*\{\s*ProfileDetailModal,\s*type ProfileDetailState,\s*\}\s*from "@\/components\/ProfileDetailModal";/,
  );
  assert.match(
    profileSource,
    /<ProfileDetailModal\s+detail=\{detail\}\s+downloadingPdf=\{downloadingPdf\}\s+onClose=\{\(\) => setDetail\(null\)\}\s+onDownloadPdf=\{downloadPdf\}\s*\/>/,
  );
  assert.doesNotMatch(
    profileSource,
    /function DetailModal\(/,
  );
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
  assert.match(
    profileDetailSource,
    /getTicketMatchName\(item\)/,
  );
  assert.match(
    profileDetailSource,
    /getTicketOrderReference\(item\)/,
  );
  assert.match(
    profileDetailSource,
    /detail\?\.type === "ticket" && ticketOrderReference/,
  );
  assert.match(
    profileDetailSource,
    /detail\?\.type === "ticket" && ticketMatchName/,
  );
});

test("ticket detail keeps the nested match card for fields such as stadium", () => {
  assert.match(
    profileDetailSource,
    /const entries = normalized\s*\? Object\.entries\(normalized\)\.filter\(\(\[key, value\]\) =>\s*shouldShowDetailField\(key, value\)\s*\)\s*: \[\];/,
  );
  assert.doesNotMatch(
    profileDetailSource,
    /detail\?\.type !== "ticket" \|\| key !== ["']match["']/,
  );
  assert.doesNotMatch(
    profileDetailSource,
    /function shouldShowDetailField\([^)]*\) \{[\s\S]*?["']match["'][\s\S]*?\.includes\(key\)[\s\S]*?\n\}/,
  );
  assert.match(
    profileDetailSource,
    /if \(isRecord\(value\)\) \{[\s\S]*?<NestedCard item=\{value\} \/>/,
  );
});

test("ticket list retains its ten-row presentation limit", () => {
  assert.match(profileSource, /visibleTickets\.slice\(0,\s*10\)/);
});
