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

function sourceBetween(start, end) {
  const startIndex = profileSource.indexOf(start);
  const endIndex = profileSource.indexOf(end, startIndex);

  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);

  return profileSource.slice(startIndex, endIndex);
}

function assertOrdered(source, markers) {
  let previousIndex = -1;

  for (const marker of markers) {
    const index = source.indexOf(marker, previousIndex + 1);
    assert.notEqual(index, -1, `Missing ordered marker: ${marker}`);
    assert.ok(index > previousIndex, `Marker is out of order: ${marker}`);
    previousIndex = index;
  }
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

test("authenticated profile operational errors are toast-only", () => {
  assert.doesNotMatch(
    profileSource,
    /const \[error,\s*setError\]/,
  );
  assert.doesNotMatch(
    profileSource,
    /setError\(/,
  );
  assert.doesNotMatch(
    profileSource,
    /<Empty title="Profile error"/,
  );
});

test("current profile load failures toast only after ownership checks", () => {
  const loadSource = sourceBetween(
    "  const load = useCallback",
    "  useFocusEffect(",
  );
  const catchSource = loadSource.slice(loadSource.indexOf("    } catch (err) {"));

  assertOrdered(catchSource, [
    "requestId !== requestIdRef.current",
    "cacheGeneration !== getUserScopedCacheGeneration()",
    ") return;",
    "toast.showToast({",
    'title: "Could not load profile"',
  ]);
  assert.match(
    profileSource,
    /\}, \[activeOwnerKey, toast\]\);/,
  );
});

test("detail failures toast only after cache-generation checks", () => {
  const orderSource = sourceBetween(
    "  const openOrder = async",
    "  const openTicket = async",
  );
  const ticketSource = sourceBetween(
    "  const openTicket = async",
    "  const downloadPdf = async",
  );
  const orderCatch = orderSource.slice(
    orderSource.indexOf("    } catch (err) {"),
  );
  const ticketCatch = ticketSource.slice(
    ticketSource.indexOf("    } catch (err) {"),
  );

  assertOrdered(orderCatch, [
    "cacheGeneration !== getUserScopedCacheGeneration()",
    "return;",
    "toast.showToast({",
    'title: "Could not load order"',
  ]);
  assertOrdered(ticketCatch, [
    "cacheGeneration !== getUserScopedCacheGeneration()",
    "return;",
    "toast.showToast({",
    'title: "Could not load ticket"',
  ]);
});

test("PDF validation and current download failures use the top error toast", () => {
  const pdfSource = sourceBetween(
    "  const downloadPdf = async",
    "  if (!auth.isReady)",
  );
  const pdfCatch = pdfSource.slice(
    pdfSource.indexOf("    } catch (err) {"),
  );

  assert.match(
    pdfSource,
    /if \(!activeOwnerKey\) return;\s*if \(!orderId\) \{\s*toast\.showToast\(\{\s*variant: "error",\s*title: "Could not download PDF",\s*message: "Order number is required to download the PDF\.",/,
  );
  assertOrdered(pdfCatch, [
    "cacheGeneration !== getUserScopedCacheGeneration()",
    "return;",
    "toast.showToast({",
    'title: "Could not download PDF"',
  ]);
  assert.equal(
    occurrenceCount(pdfSource, /title: "Could not download PDF"/g),
    2,
  );
});

test("logout failure toasts while preserving local logout navigation", () => {
  const logoutSource = sourceBetween(
    "  const logout = async",
    "  const openOrder = async",
  );

  assert.match(
    logoutSource,
    /try \{\s*await auth\.logout\(\);\s*\} catch \(err\) \{[\s\S]*?toast\.showToast\(\{[\s\S]*?title: "Could not log out"[\s\S]*?\} finally \{\s*router\.replace\("\/"\);\s*\}/,
  );
});

test("guest validation stays inline while API errors are toast-only", () => {
  const guestSource = sourceBetween(
    "function GuestAuthForm",
    "function InfoSections",
  );

  assert.match(
    guestSource,
    /setMessage\("Password confirmation does not match\."\);/,
  );
  assert.match(
    guestSource,
    /const nextMessage = "Enter the 6-digit OTP sent to your email\.";\s*setMessage\(nextMessage\);/,
  );
  assert.match(
    guestSource,
    /setMessage\(nextMessage\);\s*toast\.showToast\(\{ variant: "success", title: "OTP sent"/,
  );
  assert.equal(
    occurrenceCount(guestSource, /variant: "error"/g),
    2,
  );
  assert.doesNotMatch(
    guestSource,
    /setMessage\(nextMessage\);\s*toast\.showToast\(\{ variant: "error"/,
  );
});
