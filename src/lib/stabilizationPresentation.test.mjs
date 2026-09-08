import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tickets = await readFile(new URL("../app/tickets.tsx", import.meta.url), "utf8");
const profile = await readFile(new URL("../app/profile.tsx", import.meta.url), "utf8");
const headerActions = await readFile(new URL("../components/HeaderActions.tsx", import.meta.url), "utf8");
const profileDetail = await readFile(new URL("../components/ProfileDetailModal.tsx", import.meta.url), "utf8");
const pdfAuthority = await readFile(new URL("./profilePdfDownload.ts", import.meta.url), "utf8");

test("ticket actions expose explicit, backdrop, and Android dismissal", () => {
  assert.match(tickets, /accessibilityLabel="Close actions"/);
  assert.match(tickets, /accessibilityLabel="Close ticket actions"/);
  assert.match(tickets, /onRequestClose=\{\(\) => setActions\(false\)\}/);
});

test("payment and PDF operations use their established shared authorities", () => {
  assert.match(tickets, /const identifier = resolveOrderDetailIdentifier\(order\)/);
  assert.match(tickets, /const normalizedOrderId = normalizeOrderIdentifier\(identifier\)/);
  assert.match(tickets, /profileService\.order\(normalizedOrderId\)/);
  assert.match(tickets, /\[normalizedOrderId\]: detail/);
  assert.match(tickets, /orderDetailCache\[normalizeOrderIdentifier\(activeOrderIdentifier\)\]/);
  assert.match(tickets, /const identifier = profilePdfOrderIdentifier\(order\)/);
  assert.match(tickets, /downloadProfileOrderPdf\(\s*normalizedOrderId/);
  assert.match(tickets, /if \(!identifier \|\| downloading\)/);
  assert.match(pdfAuthority, /profileService\.orderPdf\(orderId\)/);
  assert.match(pdfAuthority, /new FileSystem\.File/);
  assert.match(pdfAuthority, /new Blob/);
  assert.match(profileDetail, /onDownloadPdf\(detail\.pdfId\)/);
  assert.doesNotMatch(profileDetail, /profileService\.orderPdf/);
});

test("Profile and My Tickets share the auth-required authority", () => {
  assert.match(profile, /<AuthRequired \/>/);
  assert.match(tickets, /withAuthRequired\(TicketsScreen\)/);
});

test("appearance control is absent from the global header", () => {
  assert.doesNotMatch(headerActions, /toggleTheme|Switch to light mode|Switch to dark mode/);
});

test("ticket faces use equal bounds and flex-balanced center groups", () => {
  assert.match(tickets, /flipPress: \{\s*height: 410,\s*position: "relative",?\s*\}/);
  assert.match(tickets, /face: \{\s*position: "absolute",\s*inset: 0/);
  assert.match(tickets, /flexRegion: \{ flexGrow: 1/);
  assert.match(tickets, /backCenter: \{ width: "100%", alignItems: "center" \}/);
  assert.doesNotMatch(tickets, /translateY|marginTop: -|top: \d/);
});
