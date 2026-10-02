import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tickets = await readFile(new URL("../app/tickets.tsx", import.meta.url), "utf8");
const profile = await readFile(new URL("../app/profile.tsx", import.meta.url), "utf8");
const tabHeader = await readFile(new URL("../components/TabHeader.tsx", import.meta.url), "utf8");
const flowHeader = await readFile(new URL("../components/FlowHeader.tsx", import.meta.url), "utf8");
const profileDetail = await readFile(new URL("../components/ProfileDetailModal.tsx", import.meta.url), "utf8");
const pdfAuthority = await readFile(new URL("./profilePdfDownload.ts", import.meta.url), "utf8");

test("the ticket viewer exposes explicit and Android dismissal", () => {
  assert.match(tickets, /onRequestClose=\{onClose\}/);
  assert.match(tickets, /backLabel=\{i18n\.t\("myTickets\.back"\)\}\s*onBack=\{onClose\}/);
});

test("PDF download keeps its established shared authority", () => {
  // The v3 ticket screen has no PDF/payment actions (they were already unreachable);
  // the authorities themselves are unchanged for any future caller.
  assert.match(pdfAuthority, /profileService\.orderPdf\(orderId\)/);
  assert.match(pdfAuthority, /new FileSystem\.File/);
  assert.match(pdfAuthority, /new Blob/);
  assert.match(profileDetail, /onDownloadPdf\(detail\.pdfId\)/);
  assert.doesNotMatch(profileDetail, /profileService\.orderPdf/);
});

test("Profile and My Tickets share the auth-required authority", () => {
  assert.match(profile, /<AuthRequired \/>/);
  assert.match(tickets, /withAuthRequired\(TicketsScreen, "myTickets\.title"\)/);
});

test("a signed-out gated subpage keeps a Back action (never a dead end) and tabs keep their tab header", async () => {
  const gate = await readFile(new URL("../components/withAuthRequired.tsx", import.meta.url), "utf8");
  assert.match(gate, /tabTitle \? \(\s*<TabHeader title=\{t\(tabTitle\)\} \/>\s*\) : \(\s*<FlowHeader/);
  assert.match(gate, /if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\("\/"\);/);
  assert.doesNotMatch(gate, /MainHeader/);
});

test("appearance control lives only in Settings, never in the app headers", () => {
  assert.doesNotMatch(tabHeader + flowHeader, /toggleTheme|setMode|Switch to light mode|Switch to dark mode/);
});

test("both ticket faces share one bounded frame and hide from assistive tech when turned away", () => {
  assert.match(tickets, /face: \{\s*position: "absolute" as const,\s*top: 0,\s*bottom: 0,\s*left: 0,\s*right: 0/);
  assert.match(tickets, /backfaceVisibility: "hidden"/);
  assert.match(tickets, /importantForAccessibility=\{flipped \? "no-hide-descendants" : "auto"\}/);
  assert.match(tickets, /importantForAccessibility=\{flipped \? "auto" : "no-hide-descendants"\}/);
  // Reduced motion swaps faces without the 3D turn.
  assert.match(tickets, /reducedMotion\s*\? \{ opacity: back === flipped \? 1 : 0 \}/);
});
