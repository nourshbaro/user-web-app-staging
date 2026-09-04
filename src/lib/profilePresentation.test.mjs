import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profile = await readFile(new URL("../app/profile.tsx", import.meta.url), "utf8");
const tickets = await readFile(new URL("../app/tickets.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../app/settings.tsx", import.meta.url), "utf8");

test("profile is a compact account hub", () => {
  for (const label of ["Edit Profile", "Settings", "About LFA Tickets", "Contact Us", "Log Out"]) assert.match(profile, new RegExp(label));
  assert.match(profile, /await auth\.logout\(\)/);
  assert.doesNotMatch(profile, /profileService\.(orders|tickets)/);
});

test("tickets use existing authorities and gesture-local state", () => {
  assert.match(tickets, /Promise\.all\(\[profileService\.orders\(\), profileService\.tickets\(\)\]\)/);
  assert.match(tickets, /horizontal pagingEnabled/);
  assert.match(tickets, /Tap to see QR code/);
  assert.match(tickets, /Tap to see ticket info/);
  assert.match(tickets, /ticket\.qr_image\.startsWith\("data:image\/"\)/);
  assert.doesNotMatch(tickets, /apiRequest\(/);
});

test("ticket lists reuse a user-scoped cache and refresh only explicitly", () => {
  assert.match(tickets, /new UserScopedCache<TicketListData>\(\)/);
  assert.match(tickets, /ticketListCache\.get\(ownerKey\)/);
  assert.match(tickets, /ticketListCache\.set\(ownerKey, nextData\)/);
  assert.match(tickets, /getUserScopedCacheGeneration\(\)/);
  assert.match(tickets, /onRefresh=\{\(\) => \{ setRefreshing\(true\); void load\(true\); \}\}/);
  assert.match(tickets, /renderedOwnerKey === ownerKey/);
});

test("settings exposes honest preferences and central deletion authority", () => {
  for (const label of ["Push Notifications", "Email Notifications", "Language", "System", "Light", "Dark", "Delete Account"]) assert.match(settings, new RegExp(label));
  assert.match(settings, /<Switch value=\{false\} disabled/);
  assert.match(settings, /theme\.setMode\(option\.value\)/);
  assert.match(settings, /<AccountDeletionModal/);
});
