import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profile = await readFile(new URL("../app/profile.tsx", import.meta.url), "utf8");
const tickets = await readFile(new URL("../app/tickets.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../app/settings.tsx", import.meta.url), "utf8");
const tournament = await readFile(new URL("../app/tournament.tsx", import.meta.url), "utf8");

test("profile is a compact account hub", () => {
  for (const label of ["Edit Profile", "Settings", "About LFA Tickets", "Contact Us", "Log Out"]) assert.match(profile, new RegExp(label));
  assert.match(profile, /await auth\.logout\(\)/);
  assert.doesNotMatch(profile, /profileService\.(orders|tickets)/);
});

test("tickets use match services and preserve QR interaction", () => {
  assert.match(tickets, /profileService\s*\.matches\(filter\)/);
  assert.match(tickets, /profileService\.tickets\(match\.match_id\)/);
  assert.doesNotMatch(tickets, /profileService\.orders\(/);
  assert.match(tickets, /horizontal\s+pagingEnabled/);
  assert.match(tickets, /Tap to see QR code/);
  assert.match(tickets, /Tap to see ticket info/);
  assert.match(tickets, /ticket\.qr_image\.startsWith\("data:image\/"\)/);
  assert.doesNotMatch(tickets, /apiRequest\(/);
});

test("ticket requests invalidate stale filters, closed details, and former sessions", () => {
  assert.match(tickets, /listRequest\.isCurrent\(request\)/);
  assert.match(tickets, /detailRequest\.isCurrent\(request\)/);
  assert.match(tickets, /listRequest\.invalidate\(\)/);
  assert.match(tickets, /detailRequest\.invalidate\(\)/);
  assert.match(tickets, /listRequest\.unmount\(\)/);
  assert.match(tickets, /getUserScopedCacheGeneration\(\)/);
  assert.match(tickets, /onRefresh=\{reload\}/);
});

test("match cards keep responsive metadata rows and selected stadium context", () => {
  assert.match(tickets, /numberOfLines=\{1\}[\s\S]*ellipsizeMode="tail"/);
  assert.match(tickets, /matchMetadataRow: \{[\s\S]*flexDirection: "row"/);
  assert.match(tickets, /matchStadium: \{ flex: 1, minWidth: 0/);
  assert.match(tickets, /matchAction: \{ flexShrink: 0/);
  assert.match(tickets, /stadium: match\.stadium/);
  assert.match(tickets, /order_number: ticket\.order_number \?\? ticket\.order_code/);
  assert.match(tickets, /teamData\(match\.home_team, match\.home_team_logo\)/);
  assert.match(tickets, /teamData\(match\.away_team, match\.away_team_logo\)/);
  assert.match(tickets, /const logo = storageUrl\(team\.logo\)/);
});

test("Tournament remains a public coming-soon screen", () => {
  assert.match(tournament, /export default function TournamentScreen/);
  assert.match(tournament, /Coming Soon/);
  assert.doesNotMatch(tournament, /AuthRequired|profileService|apiRequest/);
});

test("settings exposes honest preferences and central deletion authority", () => {
  for (const label of ["Push Notifications", "Email Notifications", "Language", "System", "Light", "Dark", "Delete Account"]) assert.match(settings, new RegExp(label));
  assert.match(settings, /value=\{false\}\s+disabled/);
  assert.match(settings, /theme\.setMode\(option\.value\)/);
  assert.match(settings, /<AccountDeletionModal/);
});


test("both notification toggle states open OS settings and use semantic contrast", () => {
  assert.match(settings, /await openSettings\(\)/);
  assert.doesNotMatch(settings, /requestPermission|pushPermissionLoading \|\| pushGranted/);
  assert.match(settings, /false: theme\.colors\.muted,\s+true: theme\.colors\.primary/);
});
