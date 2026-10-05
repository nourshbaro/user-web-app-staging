import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const profile = await read("../app/profile.tsx");
const tickets = await read("../app/tickets.tsx");
const settings = await read("../app/settings.tsx");
const tournament = await read("../app/tournament.tsx");
const competitions = await read("../app/competitions.tsx");
const competitionsService = await read("../services/competitions.ts");
const cachedReads = await read("../services/cachedReads.ts");
const about = await read("../app/about.tsx");
const editProfile = await read("../app/edit-profile.tsx");
const legalDocument = await read("../components/LegalDocumentScreen.tsx");
const photoHook = await read("../hooks/useProfilePhoto.ts");

test("profile is the v3 account hub over the existing account owners", () => {
  // Signed out: the shared sign-in card; the public destinations stay reachable.
  assert.match(profile, /<AuthRequired \/>/);
  for (const href of ['"/settings"', '"/legal"', '"/contact"']) assert.ok(profile.includes(`href=${href}`), href);
  assert.match(profile, /<ChangePassword trigger="menu" \/>/);
  // Logout: the existing confirmation and the owner's session cleanup.
  assert.match(profile, /await auth\.logout\(\)/);
  assert.match(profile, /alertDialog\.showAlert\(\{/);
  assert.match(profile, /title: "Log out\?"/);
  assert.match(profile, /variant: "destructive"/);
  assert.match(profile, /if \(!confirmed\) return;/);
  assert.match(profile, /router\.replace\("\/"\)/);
  assert.doesNotMatch(profile, /Alert\.alert/);
  assert.doesNotMatch(profile, /profileService\.(orders|tickets)/);
  // Keyed per account so one user's fresh profile never shows for the next.
  assert.match(profile, /<ProfileScreen key=\{auth\.userCacheKey \?\? "guest"\} \/>/);
});

test("name, email and phone are read-only; the avatar is the only mutation", () => {
  assert.doesNotMatch(profile, /<TextInput|onChangeText/);
  assert.doesNotMatch(profile, /authService\.(update|change)(?!Password)|updateProfile|PATCH|PUT/);
  assert.match(profile, /profile\.readOnly/);
  assert.match(photoHook, /authService\.uploadProfilePicture\(/);
  assert.match(photoHook, /authService\.removeProfilePicture\(\)/);
  assert.match(photoHook, /await auth\.updateUser\(nextUser\)/);
  // Legacy route keeps working by landing on Profile.
  assert.match(editProfile, /<Redirect href="\/profile" \/>/);
});

test("tickets use the portal services and the backend QR only", () => {
  // Through the user-scoped cached reads, which delegate to the portal service.
  assert.match(tickets, /portalReads\s*\.matches\(filter, force\)/);
  assert.match(tickets, /portalReads\.tickets\(match\.match_id\)/);
  assert.match(cachedReads, /\(\) => profileService\.matches\(filter\)/);
  assert.match(cachedReads, /\(\) => profileService\.tickets\(matchId\)/);
  assert.match(tickets, /withBackendQrs\(result\.items, \(code\) => profileService\.ticket\(code\), current\)/);
  assert.doesNotMatch(tickets, /profileService\.orders\(/);
  assert.match(tickets, /horizontal\s+pagingEnabled/);
  assert.match(tickets, /const qr = ticketQrSource\(ticket\);/);
  // No QR is generated on the device (the "qrcode" SF Symbol is only an icon).
  assert.doesNotMatch(tickets, /apiRequest\(|from "[^"]*qr[^"]*"|new QRCode|generateQr|toDataURL/i);
  assert.match(tickets, /withAuthRequired\(TicketsScreen, "myTickets\.title"\)/);
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

test("the QR frame never mirrors and non-scannable states are dimmed, not hidden", () => {
  assert.match(tickets, /<PhysicalLayout style=\{local\.qrBox\}>/);
  assert.match(tickets, /opacity: state === "valid" \|\| state === "other" \? 1 : 0\.3/);
});

test("legacy /tournament redirects to the single public Competitions screen fed by the confirmed APIs", () => {
  assert.match(tournament, /return <Redirect href="\/competitions" \/>;/);
  assert.doesNotMatch(tournament, /StatePanel|Screen|useI18n/);
  assert.match(competitions, /export default function CompetitionsScreen/);
  assert.match(competitions, /competitionReads\s*\.list\(force\)/);
  assert.match(competitions, /competitionReads\s*\.standings\(id, force\)/);
  assert.match(competitions, /competitionReads\s*\.matches\(id, force\)/);
  // The cached reads delegate to the same competition service.
  assert.match(cachedReads, /\(\) => competitionsService\.list\(\)/);
  assert.match(cachedReads, /\(\) => competitionsService\.standings\(id\)/);
  assert.match(cachedReads, /\(\) => competitionsService\.matches\(id\)/);
  assert.match(competitionsService, /apiRequest<unknown>\("\/competitions"\)/);
  // Public, no auth gate, no invented data.
  const code = competitions.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /AuthRequired|withAuthRequired|profileService|apiRequest|Math\.random|mock/);
  // Matches open the one Match Details route; Competitions never decides purchasability.
  assert.match(competitions, /router\.push\(competitionMatchRoute\(match\)\)/);
  assert.doesNotMatch(code, /isPurchasableMatchStatus|addItem|useCart/);
});

test("settings exposes only real capabilities and the central deletion authority", () => {
  assert.match(settings, /useNotificationPermission\(\)/);
  assert.match(settings, /await openSettings\(\)/);
  assert.doesNotMatch(settings, /requestPermission|requestNotificationPermission|AppSwitch|Switch\b/);
  assert.doesNotMatch(settings, /Email Notifications|storage\.set/);
  assert.match(settings, /theme\.setMode\(mode\)/);
  assert.match(settings, /<AccountDeletionModal/);
  // Language is shown, not switchable (English is the only complete catalog).
  assert.doesNotMatch(settings, /setLocale|changeLanguage/);
});

test("legal documents are the backend's own text; About lands on Legal", () => {
  assert.match(legalDocument, /legalService\.privacyPolicy\(\)/);
  assert.match(legalDocument, /legalService\.termsOfUse\(\)/);
  assert.match(about, /<Redirect href="\/legal" \/>/);
});
