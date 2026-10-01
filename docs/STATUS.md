# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-09-30 · v3 Redesign Batches 7–9 (implementation checkpoint, uncommitted on `2a5b565`)

---

## Stage

- ✅ Phase 0 — Baseline / redesign readiness (`e64a150`).
- ✅ Phase 1 — Design Foundations (`3863673`).
- ✅ Phase 2 — Navigation + Home + Match Discovery (`125ee2f`).
- ✅ Phase 3 — Match Details + Ticket Selection (`cf987f3`).
- ✅ Phase 4 — Cart + Checkout (`bc4ca08`).
- ✅ v3 Batches 1–3 — Foundation + navigation, Splash/onboarding/
  notifications, Home + Matches (`fb60043`, `20230ad`). Design reference:
  LFA Screen v3 (`docs/WORKFLOW.md` §5).
- ✅ v3 Batches 4–6 — Match Details + ticket selection, Cart + ticket
  holders, Checkout + payment results, with the startup corrections and the
  Codex corrections (`2a5b565`).
- ✅ **v3 Batches 7–9 — My Tickets, Competitions, Profile / Settings /
  Legal / Contact / Auth: implemented, pending independent review.**
  Uncommitted on `2a5b565`.
- ✅ **Codex corrections for Batches 7–9 (same checkpoint):** avatar result
  ownership, list QR recovery and representation, standings 404 / malformed
  semantics, web push settings. Pending re-review.
- ✅ Match timeline event kinds (goal / yellow_card / red_card / substitution)
  from the confirmed contract (same checkpoint).
- ▶ **Next:** Codex re-review of Batches 7–9, then Batch 10.

## Batches 7–9 checkpoint (v3)

- **My Tickets:** All / Upcoming / Past use the portal filter
  (`profileService.matches(filter)`); stub cards grouped by `is_upcoming`; a
  modal pager of flip tickets. Front: backend facts only. Back: the backend
  `qr_image` (bounded raster data URI only) in a non-mirroring frame. A
  listed ticket without a usable QR takes only `qr_image` from its detail
  endpoint (`withBackendQrs`). Status mapping: `ticketVisualState`
  (`docs/ARCHITECTURE.md` §11).
- **Competitions:** `competitionsService` (list / standings / matches);
  a standings table (W/D/L hidden below 360 px); "No standings" only for a
  successful `standings: []`; "Standings unavailable" (retry) for a 404;
  error (retry) for malformed / server / network failures; competition
  matches open `/match/[id]`.
- **Profile:** `/auth/me` facts; name, email and phone are read-only; the
  avatar sheet is the only mutation (`useProfilePhoto`; a result is
  published only while the session that started it is current); the menu holds
  Change password, Settings, Legal and Contact; logout is unchanged.
  `/edit-profile` → `/profile`.
- **Settings:** live push permission plus "Open phone settings" (iOS /
  Android builds only; web shows "Not available" with no action); appearance;
  language shown (English only, no Arabic option); account deletion.
- **Auth:** v3 presentation over the unchanged login / register / OTP /
  forgot-password logic; `AuthRequired` returns through
  `getSafeAuthReturnRoute`. No startup auth.
- **Legal / Contact:** public `/legal`, `/legal/privacy`, `/legal/terms`
  (backend text via `legalService`), and `/contact` (`OFFICIAL_CONTACTS`).
  `/about` → `/legal`. Legal was previously auth-gated through About.
- **Documented discrepancies (production wins):**
  - no Gate / Block / price / category on tickets (no such fields);
  - no ticket search;
  - the Payment info / PDF entry points are not shown (they were already
    unreachable, and the modules are kept);
  - Change password stays a sheet, with no "Forgot current password" link;
  - OTP is one field, not six boxes;
  - auth copy is still inline English;
  - Competitions adds a matches section (not in v3);
  - v3's mock legal copy is not used.
- **Backend findings (staging):**
  - standings 404 is ambiguous: the cup (2), unknown id 999, a non-numeric
    id and wrong routes all return the same `404 "Endpoint not found."`
    (2026-10-01), so it is shown as "Standings unavailable", not "No
    standings". Backend dependency: a machine-readable "no table" signal.
  - `/competitions/1/standings` → `[]`; competition 3 is now a league
    with rows (it was a cup on 2026-09-30);
  - `qr_image` representation beyond raster data URIs is unconfirmed;
  - `/competitions/1/matches` lists match 7 as `scheduled`, while
    `/matches/single/7` says `completed`. Match Details decides, so
    purchasing stays gated.
  - The legal endpoints return placeholder text ("test privacy",
    "test term of use"). This is a content dependency, not an app issue.
- **Now unused, not deleted:** `AppSwitch`, `Collapsible`,
  `MatchTicketsHeader`, `ProfileDetailModal`, and possibly
  `SheetDismissHandle`. `MainHeader` is now used only by the auth gate.

## Validation (Batches 7–9 working tree)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 4 existing warnings (`MatchSummaryBlock` ×3, `services/auth.ts`) |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **815/815 passing** (after the Codex corrections) |
| `git diff --check 2a5b565` | clean (untracked files scanned separately: clean) |
| Web / Android / iOS export | PASS (rerun after the corrections) |
| Web runtime, signed out (headless Chrome, staging, 390 px) | PASS (before the Codex corrections): Competitions light and dark (real data, match → `/match/14`); My Tickets / Settings gate; Profile signed-out state; Auth login → register → forgot (no API calls); Legal list and documents; Contact light and dark; `/about` and `/edit-profile` redirects |
| Signed-in My Tickets (flip, QR, statuses), Profile avatar, Settings, logout, register/OTP/forgot submission | NOT VERIFIED (no staging test account in this environment) |
| Codex corrections at runtime (avatar race, list-QR recovery, "Standings unavailable", web Settings card) | NOT VERIFIED at runtime; covered by deterministic tests (the avatar race against the real authentication authority) |
| Native runtime for Batches 7–9 | NOT VERIFIED (no development build or device) |

## Batches 4–6 record

### Codex corrections (2026-09-30)

- **Status gating:** `scheduled` → purchase; `live` / `completed` / other →
  `MatchInfoView` (no purchase controls even with zones). The commit
  re-reads the match (forced) before any cart mutation. If it is not
  scheduled: zero mutations, the draft is discarded, an info toast shows, and
  the screen is already on the live/result view.
- **Live/result view:** v3 result screen (score, FULL TIME / LIVE · minute,
  scorer lines, Timeline / Stats) from real events and stats. Null score
  sides, minutes and statistics are never turned into 0 or invented.
- **Checkout Back:** header and hardware Back are blocked while a submit or
  BLUE handoff is in progress; they resume after.
- **Runtime (web, signed out, staging):**
  - scheduled `/match/4`: purchase UI;
  - completed `/match/7` (1–3, no events/stats) and `/match/16` (1 : –, goal
    1', five stats): result view with zero purchase controls;
  - match 16 had become `completed` before this check, and no match was
    live on staging then, so the LIVE chip / minute was not seen at runtime
    (covered by tests with the recorded live response).
- **Not verified:** native runtime; the scheduled→live transition against a
  real kickoff; signed-in commit; Checkout Back on a device during a real
  BLUE handoff.

### Startup corrections (after runtime observations)

- **Launch splash:** the v3 branded splash is now the every-launch
  presentation (`LaunchSplash`, in memory, never persisted), not a
  first-run step. Web: seen on every load and reload (~1.25 s), then the app;
  a direct `/match/14` load keeps its route.
- **Pre-prompt cause:** the step was offered only when the OS reported
  `undetermined`, so it was silently skipped wherever the permission was
  already decided (Android ≤ 12 grants at install; earlier builds of this app
  prompted at startup). It is now offered whenever the build has a push
  runtime. "Turn on" asks the OS only when permission is not already
  granted; "Not now" never asks. It is still absent in Expo Go (no push
  runtime), and still skipped when the permission cannot be read.
- **First run ends at Home** (as in v3): both "Turn on notifications" and
  "Not now" finish onboarding and write `lfa_onboarding_v1`. There is no
  startup sign-in / guest screen; sign-in stays in the normal app journey.
- **Native runtime:** NOT VERIFIED (no development build or device here):
  first-run sequence, the native permission prompt from "Turn on", and the
  splash on a cold native launch.

### Batches 4–6 checkpoint (v3)

- **Match Details:** night hero, content sheet, "Choose where to sit" radio
  list; map collapsed by default (Show/Hide is presentation only); GA stepper
  in the action bar; reserved zones open the real seat picker as a view of the
  same screen; one confirmation action (`executeSelectionCommit` unchanged).
- **One countdown per screen:** hold bar on Match, holders and Checkout
  (read-only inside `/checkout*`); Cart keeps its own countdown card; none on
  payment or result screens.
- **Cart / holders / Checkout:** v3 cards, flow header and step bar;
  backend totals only; one field per ticket slot with first-invalid focus;
  choosing a method never pays, only "Pay {total}" / "Continue with BLUE" does.
- **Results:** the v3 paid / couldn't confirm / didn't go through layouts,
  mapped onto the existing production states. Phase 4 locks are unchanged.
- **Documented discrepancies (production wins):**
  - no crests/date on cart groups (cart items carry only `match_title`);
  - no "Reserved until HH:MM", and the countdown ring is not a progress
    fraction (no hold duration is sent; `expires_at` stays inside
    `CartContext`);
  - no Country billing row (not in the profile);
  - no Tickets/Total rows on success (not in the result params);
  - failure copy does not say "No order was created", and its actions keep
    the production destinations;
  - the expiry notice stays a toast (v3 sheet copy "No payment was taken" is
    unsafe);
  - the v3 card fields and the mock 3DS/BLUE web sheet are not reproduced
    (CyberSource form / validated BLUE WebView only);
  - the action bar is opaque (no native backdrop blur);
  - hollow unavailable seats and zoom controls are kept for non-colour
    distinction and touch targets;
  - Continue on holders stays enabled and validates on press (first-invalid
    focus) instead of v3's disabled button.

---

### Validation (Batches 4–6, at that checkpoint)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 5 existing unused-variable warnings |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **781/781 passing** (after the Codex corrections) |
| `git diff --check` | clean |
| Web / Android / iOS export | PASS |
| Web runtime, signed out (headless Chrome, staging data) | PASS: Match Details for GA (`/match/4`) and reserved seating (`/match/7`) at 390 px light/dark and 820 px; map collapsed by default; Show/Hide sends no API request; zone radios; GA stepper; the seat picker loads the real seats (150) and Back returns |
| Signed-in Match→Cart, Cart qty/remove, expiry, holders, Checkout selection | NOT VERIFIED (no staging test account in this environment) |
| Native runtime for Batches 4–6 | NOT VERIFIED (no development build or device) |

Validation for Batches 1–3 (recorded at that checkpoint): tsc, lint, 750/750
tests, exports, and web runtime for Home and Matches all passed.

| Earlier check | Result |
| ----- | ------ |
| Native runtime (onboarding, notification prompt timing, hold bar, fonts) | NOT VERIFIED — the Android emulator did not come online in this environment |
| Android filter-chip runtime | NOT VERIFIED in an installed development build; the original press-release crash fix is covered by React Native renderer regression testing |
| Reservation indicator runtime | NOT VERIFIED (needs a signed-in staging cart) |
| iOS runtime | NOT VERIFIED (Windows environment) |

Runtime checks owed for Batches 1–3 (dev build, not Expo Go):
- Fresh install at Home: splash → 3 pages → pre-prompt; "Turn on" shows the
  OS prompt, then registers; "Not now" shows no prompt; relaunch skips it.
- Launch from a notification tap / deep link / payment return: no onboarding.
- Existing signed-in user after upgrade: no onboarding; push still registers.
- Hold bar with an active cart: counts down with the cart, opens `/cart`,
  disappears at expiry (toast from `ReservationExpiryNotice`); shown on
  `/match/[id]`, and read-only on holders and Checkout; absent on `/cart`,
  the payment and result screens; status bar not covered.
- Batches 4–6, signed in (web + dev build): GA add → Cart; reserved "Hold N
  seats" → Cart; Cart quantity/remove; expiry on Cart/holders/Checkout;
  holders validation and keyboard; method selection without payment; the Card
  form and the BLUE page open only from the explicit action (no real charge).
- Custom fonts on Android/iOS (weights, no synthetic bold).

Runtime checks still owed for Phase 4:
- Android dev build: kill the app during a card submit and while the BLUE page
  is open, relaunch, confirm Checkout shows the unknown-payment state and
  cannot pay.
- Leave the BLUE page without a result, choose Card: blocked.
- A reservation expiring while the card form is open: nothing is submitted.
- Web BLUE return lands on a locked session.
- Android Expo Go starts without the notification import failure; push still
  registers and a match notification routes correctly in a dev build.
- Reserved seats: still no seated staging fixture.

---

## v3 fidelity pass (Batches 1–3, after the Codex checkpoint)

- **Rule:** LFA Screen v3 is reproduced as the visual spec (re-read through
  the design MCP); production stays authoritative for data and behaviour.
- **Global:** v3 palette in both themes (neutral-black dark; legacy roles
  mapped), v3 shadows instead of borders, v3 type sizes, Button / sheet /
  state-card / tab-bar chrome per v3.
- **Data (confirmed contract):** `/matches/scheduled?status=live|completed`
  → Matches Upcoming / Live / Results and Home Live now / Latest result;
  backend scores only. Home My Tickets card from the portal (signed in).
- **Onboarding / hold bar / Home / Matches** restyled to v3 measurements.
- **Documented discrepancies (production or accessibility wins):** light
  `textMuted` #6C6F7C for AA; no backdrop blur on the iOS tab bar; 16:9 ad
  frame (no creative cropping); real logos on a light plate; locale time
  formats (en-US 12h); no search button (no feature); no "this week / this
  month", competition filter or live count on "Show matches" (unsupported
  by the API); "All teams / All stadiums" chips for radio semantics;
  onboarding uses drawn art (the v3 photo is an unlicensed placeholder);
  Live now / Latest result are display-only (no result screen yet);
  44pt minimum touch targets where v3 draws smaller controls.
- **Web check vs a local render of v3 (headless Chrome, staging data):**
  Home, Matches (all three tabs), filter sheet, Competitions, light/dark.

## Batches 1–3 outcome (v3)

- **Foundation:** IBM Plex Sans (text) and Barlow Condensed (selective
  display) behind semantic typography roles (`src/lib/fontFamilies.ts`,
  runtime `expo-font`); display variants, radii, motion tokens, press
  feedback; additive match-day palette roles (existing values unchanged).
- **Navigation:** Home → Matches → My Tickets → Competitions → Profile;
  `/competitions` shell; `/tournament` redirects (kept in allowlists).
- **Startup:** first-run onboarding (`lfa_onboarding_v1`); notification
  permission is no longer requested at startup, only from "Turn on
  notifications" (or Settings); granted users keep registering.
- **Home:** brand header, featured-match hero, ads banner, My Tickets
  shortcut (no request), upcoming rows. No live/results/scores.
- **Matches:** v3 header, date strip on the backend `date` filter, filter bar
  and sheet, fixtures grouped by backend date.
- **Global reservation indicator:** from `CartContext.secondsLeft` only;
  header countdown pill removed.

## Phase 4 outcome

- **Cart** (`/cart`, `CartSheet`, `src/components/cart/*`):
  - lines grouped by match, the owner's total, countdown with thresholded
    announcements, and an expiry notice;
  - quantity/removal judged by the published cart; grouped removal with
    `confirmed` / `sessionEnded` / `ambiguous` results;
  - a **shared, session-scoped cart re-read gate** in `CartContext` used by
    Match Details, Cart, the sheet, Checkout and card payment.
- **Ticket holders:** grouped form, first-invalid focus, one shared payload
  builder.
- **Checkout:** readiness with the first blocker explained, Pay-handler
  re-validation against the owner's current state, radio payment options
  (Card via CyberSource, BLUE Wallet only).
- **Payment safety** (`src/lib/paymentOutcomeLock.ts`, `docs/ARCHITECTURE.md`
  §10):
  - one payment attempt per cart session across Card and BLUE, acquired and
    persisted before any submit; only the acquiring attempt passes its final
    guard;
  - expiry, session, gate and lock re-checked immediately before
    `/checkout/mobile/submit`;
  - unknown outcomes and unfinished attempts found after a restart lock the
    session; definite non-completion releases it; a different session never
    inherits it.
- **Payment screens:** catalog copy, unknown outcomes never shown as failures,
  synchronous back refusal while a card submit is in flight.
- **Expo Go:** `expo-notifications` is loaded only outside Expo Go, fixing the
  Android Expo Go import crash and its downstream "missing default export"
  route warnings. Expo Go is not a push test environment.

---

## Deferred (non-blocking) findings

- **Payments** (`docs/SECURITY.md` §3.15–§3.17):
  - a locked session cannot be unlocked in-app (no status/idempotency API);
  - web BLUE returns to a locked session (intentional);
  - a 503 on submit counts as definite non-completion.
- **BLUE retry:** after a failure redirect, retrying reopens the same stored
  payment URL (pre-existing behavior).
- **Expiry during a submit or the BLUE page:** the client clears and returns
  home; the backend stays authoritative for anything it accepted.
- **Reserved seats:** staging match 7 has seated zones (the picker was
  checked signed out); adding seats still needs a signed-in run. The
  5-minute seat cache can age (the backend add stays authoritative).
- **Backend contracts:** kickoff timezone unresolved; no structured error
  codes; no favourites or availability in the APIs used; single-match
  competition/season/matchday/scores/clock/events/stats are confirmed and
  typed, but event items and a non-null `possession` were not yet seen, and
  Match Details shows no events/stats UI (v3 has none);
  competitions/standings/competition-matches contracts are confirmed
  (`docs/API_INTEGRATION.md` §14) but not integrated yet.
- **Arabic / RTL:** no Arabic translation, and `ar` is not enabled. No
  Arabic-capable font is chosen yet (Arabic falls back to the platform font).
- **v3 carry-overs:** the dark theme keeps its navy surfaces (v3's neutral
  black would change untouched screens); legacy screens (Tickets, Profile,
  Settings, Auth…) still use `MainHeader`/platform-font text until
  redesigned; `Button` text now uses IBM Plex Sans everywhere.
- **Platforms:** iOS runtime unverified; a debug dev client can fail on a very
  slow cold Metro bundle (tooling only).
- **Web (dev):** a "Failed to handle initial notification" toast appears in a
  headless browser (pre-existing).
- **Legacy screens:** screens not yet redesigned still use the old `muted`
  colour and the `accessibilityState` object.
- **Unused modules:** keep until a scoped cleanup (`CardPaymentPreparationContext`,
  `ProfileDetailModal`, `bluePaymentDiagnostics`, unused push-token helpers,
  `profileService.orders()`; since Batches 4–6 also `MatchTicketsHeader` and
  `Collapsible`).
- **Security and backend** concerns remain tracked in `docs/SECURITY.md` §3 and
  `docs/API_INTEGRATION.md` §14.
