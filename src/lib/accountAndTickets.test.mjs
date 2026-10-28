import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  competitionMatchRoute,
  formatGoalDifference,
  normalizeCompetitionMatches,
  normalizeCompetitions,
  normalizeStandings,
  standingsView,
} from "./competitions.ts";
import { pushSettingsSupported, selectableLanguages, settingsPushState } from "./settingsPresentation.ts";
import {
  rawStatusLabel,
  ticketIsScannable,
  ticketListSections,
  ticketListView,
  ticketQrSource,
  ticketSeatFacts,
  ticketVisualState,
  withBackendQrs,
} from "./ticketPresentation.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/* ------------------------------------------------------------------------ *
 * My Tickets
 * ------------------------------------------------------------------------ */

const portal = [
  { match_id: 4, is_upcoming: true },
  { match_id: 7, is_upcoming: false },
  { match_id: 9, is_upcoming: true },
];

test("All / Upcoming / Past follow the backend (filter endpoint + is_upcoming), never the kickoff date", () => {
  assert.deepEqual(ticketListSections("all", portal).map((section) => [section.key, section.items.map((m) => m.match_id)]), [
    ["upcoming", [4, 9]],
    ["past", [7]],
  ]);
  // The Upcoming / Past filters render exactly what the backend returned for that filter.
  assert.deepEqual(ticketListSections("upcoming", portal).map((section) => section.items.length), [3]);
  assert.deepEqual(ticketListSections("past", []), []);
});

test("the list shows loading, error, empty or list — a failure is never shown as an empty list", () => {
  assert.equal(ticketListView({ loading: true, error: false, count: 3 }), "loading");
  assert.equal(ticketListView({ loading: false, error: true, count: 0 }), "error");
  assert.equal(ticketListView({ loading: false, error: false, count: 0 }), "empty");
  assert.equal(ticketListView({ loading: false, error: false, count: 2 }), "list");
});

test("ticket status maps only backend-justified states", () => {
  assert.equal(ticketVisualState({ status: "valid", checked_in_at: null }), "valid");
  // Check-in evidence on a valid ticket: used.
  assert.equal(ticketVisualState({ status: "valid", checked_in_at: "2026-09-30T18:02:00Z" }), "used");
  assert.equal(ticketVisualState({ status: "used", checked_in_at: null }), "used");
  assert.equal(ticketVisualState({ status: "Checked-In", checked_in_at: null }), "used");
  assert.equal(ticketVisualState({ status: "expired", checked_in_at: null }), "expired");
  // Cancelled only when the backend says so.
  assert.equal(ticketVisualState({ status: "cancelled", checked_in_at: null }), "cancelled");
  assert.equal(ticketVisualState({ status: "canceled", checked_in_at: null }), "cancelled");
  assert.notEqual(ticketVisualState({ status: "refunded", checked_in_at: null }), "cancelled");
  // Unknown statuses keep no invented meaning, even with a check-in timestamp.
  assert.equal(ticketVisualState({ status: "pending_transfer", checked_in_at: "2026-09-30T18:02:00Z" }), "other");
  assert.equal(ticketVisualState({ status: "", checked_in_at: null }), "other");
  assert.equal(rawStatusLabel("pending_transfer"), "Pending transfer");
  assert.equal(ticketIsScannable("valid"), true);
  for (const state of ["used", "expired", "cancelled", "other"]) assert.equal(ticketIsScannable(state), false, state);
});

test("the QR is the backend image only — never generated from the ticket code", () => {
  const qr = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(ticketQrSource({ qr_image: qr, ticket_code: "LFA-1" }), qr);
  assert.equal(ticketQrSource({ qr_image: "data:image/jpeg;base64,/9j/4AAQ", ticket_code: "LFA-1" }), "data:image/jpeg;base64,/9j/4AAQ");
  assert.equal(ticketQrSource({ qr_image: "data:image/webp;base64,UklGRg==", ticket_code: "LFA-1" }), "data:image/webp;base64,UklGRg==");
  // Empty, null, missing: no QR (the detail endpoint may supply it).
  assert.equal(ticketQrSource({ qr_image: "", ticket_code: "LFA-1" }), null);
  assert.equal(ticketQrSource({ qr_image: null, ticket_code: "LFA-1" }), null);
  assert.equal(ticketQrSource({ ticket_code: "LFA-1" }), null);
  assert.equal(ticketQrSource(null), null);
});

test("only bounded raster data URIs are accepted; other representations are not guessed", () => {
  for (const value of [
    "https://example.com/qr.png",
    "http://example.com/qr.png",
    "/storage/qr/LFA-1.png",
    "qr/LFA-1.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:text/html;base64,PGgxPg==",
    "data:image/png,rawbytes",
    "data:image/png;base64,<script>",
    "data:image/png;base64,",
    "LFA-1",
    `data:image/png;base64,${"a".repeat(512_001)}`,
    42,
  ]) {
    assert.equal(ticketQrSource({ qr_image: value, ticket_code: "LFA-1" }), null, String(value).slice(0, 40));
  }
});

test("listed tickets without a usable QR take it from their own detail response, and nothing else", async () => {
  const qr = "data:image/png;base64,QUJD";
  const listed = [
    { ticket_code: "1", status: "valid", qr_image: qr },
    { ticket_code: "2", status: "valid", qr_image: "" },
    { ticket_code: "3", status: "valid", qr_image: null },
    { ticket_code: "4", status: "valid" },
    { ticket_code: "5", status: "valid", qr_image: "https://example.com/qr.png" },
  ];
  const details = {
    2: { ticket_code: "2", status: "used", qr_image: "data:image/png;base64,MjIy" },
    3: { ticket_code: "3", qr_image: null },
    4: { ticket_code: "4", qr_image: "data:image/svg+xml;base64,PHN2Zz4=" },
    5: { qr_image: "data:image/png;base64,NTU1" },
  };
  const fetched = [];
  const result = await withBackendQrs(listed, async (code) => {
    fetched.push(code);
    return details[code];
  }, () => true);
  assert.deepEqual(fetched, ["2", "3", "4", "5"], "a listed QR needs no detail request");
  assert.deepEqual(result.map((ticket) => [ticket.ticket_code, ticket.status, ticketQrSource(ticket)]), [
    ["1", "valid", qr],
    ["2", "valid", "data:image/png;base64,MjIy"], // only the QR is taken; the listed status stays
    ["3", "valid", null], // the detail had none: "QR unavailable", nothing generated
    ["4", "valid", null], // an unsafe detail representation is not used
    ["5", "valid", "data:image/png;base64,NTU1"],
  ]);
});

test("QR recovery stops for a superseded view and a failed detail request surfaces as an error", async () => {
  const fetched = [];
  const stale = await withBackendQrs([{ ticket_code: "2", qr_image: null }], async (code) => fetched.push(code), () => false);
  assert.deepEqual(fetched, []);
  assert.equal(stale[0].qr_image, null);
  await assert.rejects(() => withBackendQrs([{ ticket_code: "2" }], async () => { throw new Error("detail failed"); }, () => true), /detail failed/);
});

test("the ticket screen recovers QRs through the shared rule and never generates one", async () => {
  const screen = await read("../app/tickets.tsx");
  assert.match(screen, /withBackendQrs\(\s*result\.items\s*,\s*\(code\)\s*=>\s*profileService\.ticket\(code\)\s*,\s*current\s*,?\s*\)/);
  assert.doesNotMatch(screen, /\.\.\.\(await profileService\.ticket/, "the detail response is not spread over the listed ticket");
  assert.doesNotMatch(screen, /from "[^"]*qr[^"]*"|new QRCode|generateQr|toDataURL|qr_image: ticket\.ticket_code/i);
});

test("seat facts come from the backend seat record only; GA has none", () => {
  assert.deepEqual(ticketSeatFacts(null), { row: null, seat: null });
  assert.deepEqual(ticketSeatFacts({ row: "A", number: "12" }), { row: "A", seat: "12" });
  assert.deepEqual(ticketSeatFacts({ label: "A12" }), { row: null, seat: "A12" });
});

test("the ticket screen renders only supported facts (no gate, block, price, category or expiry)", async () => {
  const screen = await read("../app/tickets.tsx");
  assert.doesNotMatch(screen, /\bgate\b|\bblock\b|price|category|membership|refund/i);
  assert.match(screen, /ticketVisualState\(ticket\)/);
  assert.match(screen, /ticket\.checked_in_at/);
});

/* ------------------------------------------------------------------------ *
 * Competitions
 * ------------------------------------------------------------------------ */

// Structurally the staging responses (2026-09-30).
const competitionsPayload = {
  data: [
    { id: 1, name: "test", short_name: null, slug: "test", logo: "competitions/logos/a.jpg", format: "league" },
    { id: 2, name: "testtt", short_name: null, slug: "test2", logo: "competitions/logos/b.jpg", format: "cup" },
    { id: 3, name: "this is a test", short_name: "TIAT", slug: "this-is-a-test", logo: "competitions/logos/c.png", format: "cup" },
    { id: "bad", name: "" },
  ],
};

test("competition responses normalize to valid entries only", () => {
  const list = normalizeCompetitions(competitionsPayload);
  assert.deepEqual(list.map((item) => [item.id, item.shortName, item.format]), [
    [1, null, "league"],
    [2, null, "cup"],
    [3, "TIAT", "cup"],
  ]);
  assert.throws(() => normalizeCompetitions({ data: null }));
});

const standingRow = (rank, name, extra = {}) => ({
  rank,
  team: { id: rank, name, short_name: null, logo: null },
  played: 3, won: 2, drawn: 1, lost: 0, goals_for: 5, goals_against: 2, goal_difference: 3, points: 7,
  ...extra,
});
const standingsPayload = (standings) => ({
  data: { competition: { id: 1, name: "test", short_name: null }, season: { id: 3, label: "26-2027", is_current: true }, standings },
});

test("valid non-empty standings map the real fields and sort by rank", () => {
  const standings = normalizeStandings(standingsPayload([standingRow(2, "Ansar", { points: 4 }), standingRow(1, "Nejmeh")]));
  assert.deepEqual(standings.season, { id: 3, label: "26-2027", isCurrent: true });
  assert.deepEqual(standings.rows.map((r) => [r.rank, r.team.name, r.points]), [[1, "Nejmeh", 7], [2, "Ansar", 4]]);
  assert.equal(standingsView({ loading: false, error: false, standings: { kind: "table", standings } }), "table");
  assert.equal(formatGoalDifference(3), "+3");
  assert.equal(formatGoalDifference(0), "0");
  assert.equal(formatGoalDifference(-2), "-2");
});

test("only a successful standings: [] is 'No standings'", () => {
  const empty = normalizeStandings(standingsPayload([]));
  assert.deepEqual(empty.rows, []);
  assert.equal(standingsView({ loading: false, error: false, standings: { kind: "table", standings: empty } }), "none");
  assert.equal(standingsView({ loading: false, error: false, standings: { kind: "unavailable" } }), "unavailable");
  assert.equal(standingsView({ loading: true, error: false, standings: null }), "loading");
  assert.equal(standingsView({ loading: false, error: true, standings: null }), "error");
  assert.equal(standingsView({ loading: false, error: false, standings: null }), "error", "no result is never an empty table");
});

test("a malformed successful standings response is an error, not an empty or partial table", () => {
  for (const payload of [{ data: {} }, { data: { standings: null } }, { data: { standings: {} } }, { data: null }, null]) {
    assert.throws(() => normalizeStandings(payload), /Invalid standings/, JSON.stringify(payload));
  }
  // One incomplete row would silently drop a team (or need invented zeros): reject the table.
  assert.throws(() => normalizeStandings(standingsPayload([standingRow(1, "Nejmeh"), standingRow(2, "Safa", { points: null })])), /Invalid standings row/);
  assert.throws(() => normalizeStandings(standingsPayload([standingRow(1, "Nejmeh"), "row"])), /Invalid standings row/);
});

async function loadCompetitionsService() {
  const libSource = await read("./competitions.ts");
  const serviceSource = await read("../services/competitions.ts");
  const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.\.\/i18n\/[^"\n]+\.ts)"/g, (_, path) => `from ${JSON.stringify(new URL(path, import.meta.url).href)}`);
  const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const key = `__competitionsApi_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  globalThis[key] = { next: null };
  const api = dataUrl(`
    export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
    export class ApiTransportError extends Error { constructor(message, category) { super(message); this.category = category; } }
    export async function apiRequest(path) { const next = globalThis[${JSON.stringify(key)}].next; if (next instanceof Error) throw next; return next; }
  `);
  const { ApiError, ApiTransportError } = await import(api);
  const service = transpile(serviceSource)
    .replace('from "@/lib/competitions"', `from ${JSON.stringify(dataUrl(transpile(libSource)))}`)
    .replace('from "@/services/api"', `from ${JSON.stringify(api)}`);
  const { competitionsService } = await import(dataUrl(service));
  return { competitionsService, ApiError, ApiTransportError, respond: (next) => { globalThis[key].next = next; }, cleanup: () => delete globalThis[key] };
}

test("standings service: tables and [] succeed; a 404 is 'unavailable', never an empty table", async () => {
  const s = await loadCompetitionsService();
  try {
    s.respond(standingsPayload([standingRow(1, "Nejmeh")]));
    const table = await s.competitionsService.standings(1);
    assert.equal(table.kind, "table");
    assert.equal(table.standings.rows.length, 1);
    s.respond(standingsPayload([]));
    assert.deepEqual((await s.competitionsService.standings(1)).standings.rows, []);
    // Staging answers a cup, an unknown id and a wrong route with this same 404 body:
    // nothing machine-readable marks the cup case, so it is "unavailable" (retryable), not "none".
    s.respond(new s.ApiError("Endpoint not found.", 404));
    assert.deepEqual(await s.competitionsService.standings(2), { kind: "unavailable" });
    assert.deepEqual(await s.competitionsService.standings(999), { kind: "unavailable" });
  } finally { s.cleanup(); }
});

test("standings service: malformed success, server and network failures reject (the screen shows error + retry)", async () => {
  const s = await loadCompetitionsService();
  try {
    s.respond({ data: { competition: { id: 1, name: "test" } } });
    await assert.rejects(() => s.competitionsService.standings(1), /Invalid standings response/);
    s.respond(new s.ApiError("Server error", 500));
    await assert.rejects(() => s.competitionsService.standings(1), (error) => error.status === 500);
    s.respond(new s.ApiTransportError("offline", "network"));
    await assert.rejects(() => s.competitionsService.standings(1), /offline/);
  } finally { s.cleanup(); }
});

test("the Competitions screen gives 'unavailable' its own honest, retryable state", async () => {
  const screen = await read("../app/competitions.tsx");
  assert.match(screen, /view === "unavailable" \? \(\s*<StatePanel[\s\S]*?competitions\.standings\.unavailable\.title[\s\S]*?onPress: retryDetail/);
  // Retry is a real backend read, never the cached "unavailable" answer replayed.
  assert.match(screen, /const retryDetail = \(\) => \{\s*if \(selectedId !== null\) void loadDetail\(selectedId, knockout, "retry"\);/);
  assert.match(screen, /standings\.data\?\.kind === "table"/);
});

test("competition matches keep nullable scores and always open the one Match Details route", () => {
  const matches = normalizeCompetitionMatches({
    data: [
      { id: 12, match_date: "2026-11-24", kickoff_at: "22:00:00", status: "scheduled", matchday: 2, round_name: null, matchday_label: "Matchday 2", home_team: { id: 12, name: "Nejmeh", short_name: null, logo: "t/n.png" }, away_team: { id: 6, name: "Sagesse", short_name: null, logo: "t/s.jpg" }, home_score: null, away_score: null, stadium: { id: 9, name: "Fouad Chehab Stadium", location: "Jounieh, Lebanon" } },
      { id: 16, match_date: "2026-09-30", kickoff_at: "11:00:00", status: "live", matchday: 2, round_name: null, matchday_label: "Matchday 2", home_team: { id: 12, name: "Nejmeh" }, away_team: { id: 2, name: "Ansar" }, home_score: 1, away_score: null, stadium: { id: 9, name: "Fouad Chehab Stadium" } },
      { id: 14, match_date: "2026-09-30", kickoff_at: "08:15:00", status: "completed", matchday: 1, round_name: null, matchday_label: "Matchday 1", home_team: { id: 5, name: "Al Safa" }, away_team: { id: 3, name: "Juwaya Al Riyadi" }, home_score: 1, away_score: 0, stadium: null },
      { id: 99, status: "scheduled" },
    ],
  });
  assert.deepEqual(matches.map((m) => [m.id, m.status, m.home_score, m.away_score]), [
    [12, "scheduled", null, null],
    [16, "live", 1, null],
    [14, "completed", 1, 0],
  ]);
  // Scheduled, live and completed all go to the existing route; its backend status decides the experience.
  for (const match of matches) {
    assert.deepEqual(competitionMatchRoute(match), { pathname: "/match/[id]", params: { id: String(match.id) } });
  }
});

/* ------------------------------------------------------------------------ *
 * Profile / Settings / Auth
 * ------------------------------------------------------------------------ */

test("profile facts use only backend fields (no invented verification or membership)", async () => {
  const facts = (await import("./profileFacts.ts")).profileFacts;
  const verified = facts({ name: "Karim Haddad", email: "k@example.com", phone: "+96171234567", email_verified_at: "2025-03-02T10:00:00Z", created_at: "2025-03-01T10:00:00Z" });
  assert.equal(verified.initials, "KH");
  assert.equal(verified.emailVerified, true);
  assert.equal(verified.memberSince?.getUTCFullYear(), 2025);
  const bare = facts({ name: "", email: "k@example.com", phone: null, email_verified_at: null, created_at: "not a date" });
  assert.equal(bare.emailVerified, false);
  assert.equal(bare.memberSince, null);
  assert.equal(bare.phone, null);
  assert.equal(bare.name, "k@example.com");
});

test("settings present the OS permission state and no fake language option", () => {
  assert.deepEqual(settingsPushState("granted", false), { state: "on", actionable: true });
  assert.deepEqual(settingsPushState("denied", false), { state: "off", actionable: true });
  assert.deepEqual(settingsPushState("undetermined", false), { state: "notAsked", actionable: true });
  assert.deepEqual(settingsPushState("granted", true), { state: "checking", actionable: true });
  // One complete catalog (English) means nothing selectable is shown.
  assert.deepEqual(selectableLanguages(["en"]), []);
  assert.deepEqual(selectableLanguages(["en", "ar"]), ["en", "ar"]);
});

test("push settings are actionable only in an iOS / Android build with a push runtime; web says so instead", async () => {
  assert.equal(pushSettingsSupported("ios", true), true);
  assert.equal(pushSettingsSupported("android", true), true);
  assert.equal(pushSettingsSupported("web", true), false);
  assert.equal(pushSettingsSupported("ios", false), false, "Expo Go has no push runtime");
  for (const permission of ["granted", "denied", "undetermined"]) {
    for (const loading of [true, false]) {
      assert.deepEqual(settingsPushState(permission, loading, false), { state: "unsupported", actionable: false });
    }
  }
  const screen = await read("../app/settings.tsx");
  assert.match(screen, /settingsPushState\(pushPermission, pushPermissionLoading, pushSettingsSupported\(Platform\.OS, pushRuntimeSupported\)\)/);
  assert.match(screen, /\{push\.actionable \? \(\s*<Pressable[\s\S]*?settings\.push\.open[\s\S]*?<\/Pressable>\s*\) : null\}/);
});

test("avatar upload and removal publish only through the session-ownership guard", async () => {
  const hook = await read("../hooks/useProfilePhoto.ts");
  const guarded = hook.match(/runOwnedAvatarMutation\(\{\s*capture: captureAuthenticationSnapshot,\s*isCurrent: isAuthenticationSnapshotCurrent,/g) ?? [];
  assert.equal(guarded.length, 2, "upload and removal");
  assert.match(hook, /request: \(\) => authService\.uploadProfilePicture\(/);
  assert.match(hook, /request: \(\) => authService\.removeProfilePicture\(\)/);
  // A stale result returns before any toast; the services are never called outside the guard.
  assert.equal((hook.match(/if \(outcome === "stale"\) return;/g) ?? []).length, 2);
  assert.equal((hook.match(/authService\.(upload|remove)ProfilePicture\(/g) ?? []).length, 2);
  assert.doesNotMatch(hook, /await publish\(/);
});

test("the redesigned auth screen keeps every production service call and return handling", async () => {
  const auth = await read("../app/auth.tsx");
  for (const call of [
    /authService\.login\(/,
    /authService\.register\(/,
    /authService\.verifyOtp\(/,
    /authService\.resendOtp\(/,
    /authService\.forgotPassword\(/,
    /authService\.verifyForgotPasswordOtp\(/,
    /authService\.resetPassword\(/,
    /authService\.completePhone\(/,
  ]) {
    assert.match(auth, call);
  }
  assert.match(auth, /router\.dismissTo\(returnTo as never\)/);
  assert.match(auth, /const returnTo = getSafeAuthReturnRoute\(params\.returnTo\);/);
  // Credentials are never logged or put in route params.
  assert.doesNotMatch(auth, /console\.(log|info|debug)/);
  assert.doesNotMatch(auth, /params[^\n]*password/);
});

test("no startup authentication gate returns", async () => {
  const chrome = await read("../components/AppChrome.tsx");
  const layout = await read("../app/_layout.tsx");
  for (const source of [chrome, layout]) assert.doesNotMatch(source, /pathname: "\/auth"|router\.(push|replace)\("\/auth"/);
});
