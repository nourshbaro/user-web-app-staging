# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-10-21 · Arabic/English localization and review corrections (uncommitted)

---

## Stage

- **Arabic/English localization:** implemented on the existing i18n owner,
  with review corrections for the single signed-out selector, bilingual country
  search/localized sorting, Arabic plurals, explicit billing direction metadata,
  native SDK-load error copy and dedicated ticket-title keys.
  Exactly `en`/`ar` are enabled. `lfa_locale` persists independently of auth;
  restoration precedes content and invalid values default to English. Text and
  future LFA JSON/PDF requests update immediately; the web proxy forwards
  `Accept-Language: en|ar`. Third-party payment transports are excluded.
  Web direction updates immediately; native direction requires a user-initiated
  restart, retaining startup mismatch/reload-loop guards and mounted owners
  during runtime switching. Arabic uses the platform font.
  **NOT VERIFIED:** physical-device RTL, payment-flow testing with language
  switching/restarts, and authenticated backend translation support. Local
  header/regression tests do not establish these. Manual QA remains required.
  Local correction checks: TypeScript passes; lint has 0 errors and 2 existing
  unused-variable warnings; the full Node suite passes 1,072/1,072 tests,
  including selector, country sorting/search, plural/placeholder and native
  SDK error-event regressions. These are automated checks, not device evidence.

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
- ✅ v3 Batches 7–9 — My Tickets, Competitions, Profile / Settings / Legal /
  Contact / Auth, with the Codex corrections and the match-event kinds
  (`a046a11`).
- ✅ v3 Batch 10 — whole-app accessibility, RTL, responsive, motion, cleanup
  and regression closure (`75cb896`). The in-place redesign is complete.
- ✅ **Post-redesign product corrections (passes 1 and 2): implemented,
  pending review.** Uncommitted on `75cb896`.
- ✅ Post-redesign corrections committed (`15eb650`).
- ✅ **System states + Design C icon: implemented, pending review.**
  Uncommitted on `15eb650`.
- ✅ Authentication & Recovery: implemented, Codex-reviewed (PASS WITH
  FINDINGS; the MEDIUM finding fixed); committed (`3836c81`).
- ✅ **Phone recovery branching correction: implemented, Codex PASS.**
  Uncommitted on `39ea18d`.
- ▶ **Next:** commit approval; the backend dependencies below.

## Phone recovery branching correction (2026-10-07)

Authoritative rule for `POST /auth/forgot-password` started with a phone,
branching only on the structured `reason` (never message text):

- `reason: "email_required"` → **add email** → OTP → new password → Sign in
  (add-email sends the reducer-bound phone; the code step is then keyed by the
  added email).
- any other successful answer → **OTP immediately**, bound to the phone that
  started the attempt (`phoneCodeSent`). The flow no longer stays on the
  phone step.

Verify, reset and resend send the attempt's one recovery identity
(`recoveryTarget`: the address the code was sent to, otherwise the bound
phone; none before a code exists). Stale-attempt protection, the shared
synchronous Verify / Resend guard, the six-cell OTP over one six-digit value
and memory-only codes / passwords are unchanged.

**Current staging limitation (verified 2026-10-07, non-existent identifiers
only):** `forgot-password/verify-otp` `{ phone, code }` → 422 "The email field
is required."; `reset-password` with `phone` → 422 "The email field is
required." **Phone → OTP is implemented; Phone → OTP → New Password → Sign in
is not yet end-to-end functional**: Verify on a phone-bound code shows that
422 inline and keeps the step. No email is invented. Backend dependency
(`docs/API_INTEGRATION.md` §5.2–§5.3).

**Validation:**

| Check | Result |
| --- | --- |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **1040/1040 passing** |
| `npx tsc --noEmit` | clean |
| `npx expo lint` | 0 errors, 1 existing warning (`services/auth.ts` `fields`) |
| `git diff --check` | clean |

**Not runtime-verified:** the phone → OTP step and the add-email screen in the
app (no staging test account); completing any phone reset (blocked by the
backend).

## Authentication & Recovery (2026-10-06)

Design: LFA Screen v3 `login`, `register`, `forgot`, `forgot_email`,
`forgot_otp`, `forgot_new` (read live). Contracts: `docs/API_INTEGRATION.md`
§5.1–§5.2; security: `docs/SECURITY.md` §2.2a, §3.18–§3.19.

**Implemented:**
- Sign in with **email or phone** (v3 Email | Phone number toggle); the phone
  is the shared international-phone value sent as digits only
  (`96171123456`).
- Registration with an **optional email** (omitted when empty, validated
  when given); a valid phone required.
- **Nullable user email** (`email: null` for phone-only accounts) accepted by
  `/auth/me` validation, the persisted-user decoder and checkout's billing
  read.
- Password recovery entry by **email or phone**; a phone account without an
  email follows `email_required` → **add email** (`/auth/forgot-password/add-email`)
  → code → new password → Sign in.
- One recovery owner (`src/lib/passwordRecovery.ts`) with **stale-attempt
  protection** (identifier / method changes, Back, cancel, completion).
- **Synchronous submission guard** shared by recovery submit and "Resend
  code" (the Codex MEDIUM finding: a resend could overlap a verify; fixed,
  with regression coverage).
- Auth copy moved to the i18n catalog (`auth.*` keys).

**Recovery requirement correction (2026-10-06, after Codex):**
- The required product flow (phone with an email → OTP without typing the
  email; unavailable email → backend message → "Try phone number") is
  **not supported by the staging contract** (re-probed:
  verify / reset still require `email`; unknown emails still get the generic
  answer). It is recorded as a pending backend dependency with an exact
  change request in `docs/API_INTEGRATION.md` §5.3; no workaround was built.
- Removed the superseded fallback that told a phone user to switch to Email
  and type the account's address. (The phone generic answer now opens the
  OTP step — see the 2026-10-07 correction above.)
- v3 six-cell OTP (`src/components/account/OtpCodeInput.tsx`) on both code
  steps: one numeric six-digit value, one native input (paste, iOS
  `oneTimeCode` / Android `sms-otp` autofill), active-cell ring and caret
  (static under reduced motion), never mirrored; existing Verify and real
  resend, no countdown.

**Validation (final working tree):**

| Check | Result |
| --- | --- |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **1034/1034 passing** |
| `npx tsc --noEmit` | clean |
| `npx expo lint` | 0 errors, 1 existing warning (`services/auth.ts` `fields`) |
| `git diff --check` | clean |
| `npx expo export --platform ios` | PASS (after the correction) |

**Android runtime of the correction (emulator, staging, signed-in user's
session untouched; non-existent emails and the probe account's phone only):**
six cells with the active ring and caret; non-digits dropped; six-digit
limit; Verify enabled only when complete and reaching the backend
("Invalid or expired code." inline, step kept); real Resend ("Code sent");
a throttled request shows the backend's "Too many requests." inline;
no email prompt on the phone path (the 2026-10-06 build then stayed on the
phone step; superseded by the 2026-10-07 correction). Paste and OS autofill were not exercised (no SMS / clipboard
source on the emulator).

**Android runtime (emulator, dev build, staging; before the Codex fix):**
the toggle; an invalid phone (inline error, Sign in disabled); Forgot
password keeping the method and number; phone recovery's generic answer
(that build stayed on the phone step; superseded on 2026-10-07); email
recovery to the code step; a wrong code
(backend error inline, step kept); Back code → method step → Sign in; the
register layout; a real **phone sign-in** and log-out.

**Not runtime-verified:** the add-email screen; completing a reset; a
registration submit; dark mode, narrow and tablet widths; iOS runtime
(needs a real iPhone: keyboard avoidance, one-time-code autofill).

**Documented discrepancies (production wins):** Remember me and the sign-in
Back header are kept; "Resend code" without v3's countdown (no
backend-provided resend interval); v3's "We'll text you a code" register note dropped (staging
issues a session with no code); no "try your phone" state (not in v3, and no
backend signal).

**Backend dependencies (not frontend TODOs):**
1. **HIGH — `add-email` ownership:** the endpoint is unauthenticated and
   persisted an email on an email-less account before any ownership proof
   (`docs/SECURITY.md` §3.18).
2. **Phone recovery after the generic answer cannot complete:** the client
   reaches the OTP step bound to the phone, but staging verify / reset reject
   `phone` (422 "The email field is required.", verified 2026-10-07).
   Required: verify / reset accepting the phone, or the recommended
   recovery-token contract (`docs/API_INTEGRATION.md` §5.3, not implemented).
3. **No unknown-email → phone branching:** the generic email answer hides
   whether an email exists. Required: a distinct `email_not_found` answer
   with a user-facing message, accepting the enumeration trade-off
   (§5.3), or the product keeps the generic answer.
4. **Phone-only users and checkout:** checkout requires a billing email that
   a phone-only account lacks and cannot add through supported profile
   editing.
5. **Register `password_confirmation`** is not enforced server-side on
   staging; needs correction or clarification (`docs/SECURITY.md` §3.19).

## System states and launcher icon (2026-10-02)

Spec read live from LFA Screen v3: the `maintenance`, `update_available`
and `update_required` states. Architecture: `docs/ARCHITECTURE.md` §13.

**Startup priority (one state, never stacked):** maintenance → required
update → optional update → normal app.

**Implemented UI / policy:**
- `SystemStateGate` replaces `MaintenanceGuard`.
  - v3 `MaintenanceScreen` replaces `UnderConstruction503`.
  - v3 `UpdatePromptDialog` serves both update states.
- Update policy (`src/lib/appUpdatePolicy.ts`), now backend-authoritative
  (`GET /app-versions/check`, integrated 2026-10-05):
  - the backend flags decide (required wins); no client version comparison;
  - asked once per launch with the real platform and installed version, no
    session token; every failure fails open;
  - the backend `message` is the "What's new" panel, one bullet per
    sentence (`messagePoints`); no message → no panel;
  - version-free copy when no valid latest version exists;
  - a whole-string store-URL allowlist; an update without a valid official
    listing is not shown. React Native's `URL` is a lenient shim, so
    parsing with it is not trustworthy on device.
  - During 2026-10-06 verification, staging returned a required update for
    app version `1.1.4`, with minimum supported version `1.4.0`. This is a
    dated backend-policy observation, not a client-hardcoded minimum.
    Earlier Android dialog checks used a temporary local sample answer.
- WhatsApp link: the official contact in `src/lib/contact.ts`
  (+961 70 447 888, the same number v3 uses).

**Existing authoritative maintenance support, now recoverable:**
- Any 503 still activates maintenance.
- "Try again" → `recheckMaintenance`:
  - one anonymous `GET /matches/scheduled/filters` through `apiRequest`;
  - single-flight, with no polling;
  - it clears only on a 2xx with no 503 meanwhile.
- Session, cart and payments are untouched.

**Development preview (`__DEV__` only):**
`lfa-app:///?systemStatePreview=maintenance|updateAvailable|updateRequired|normal`.
It changes only the rendered preview in development; it does not change
the backend answer or production policy authority. Production bundles
cannot activate it.

**Backend update authority (integrated):**
- `GET /app-versions/check?platform=<ios|android>&version=<installed>` uses
  the running application's platform and Expo-config version, once per launch.
- The check is anonymous; a 401/403 cannot invalidate authentication.
  Backend `update_required` / `update_available` flags decide the result.
- Required updates are blocking; optional updates are dismissible. The
  client validates the official store listing, including when opening it.
  Network failures, malformed answers, unusable installed versions or no
  usable store listing fail open; web has no native update prompt.
- Activation no longer waits for a backend contract. Each environment's
  backend policy determines whether an update is offered or required
  (`docs/API_INTEGRATION.md` §14); the staging observation above does not
  establish the production environment's current policy.

**Launcher icon (Design C):**
- `app.json` uses `assets/images/app-icon-ios.png` (1024),
  `app-icon-android.png` (512) and
  `app-icon-android-foreground.png` (adaptive, background `#E9E9EE`).
- The old `lfa-app-icon*.png` files remain, unreferenced (legacy).

**Android runtime (2026-10-02 checkpoint; emulator, signed-in dev build,
staging, new JS over Metro):**
- Verified:
  - normal startup with no prompt;
  - maintenance, and Try again (busy state, real probe, recovered to
    Home with the session intact);
  - required update: Back ×2 swallowed; the store tap without a URL
    opens nothing and shows the inline error;
  - update available: Not now and Back both dismiss;
  - dark mode; tablet (~800 dp); narrow (~360 dp);
  - the scrim measured at 50% black.
- Found and fixed: the dialog state carried over between prompts
  (now keyed per prompt).
- Known quirk: after maintenance clears, the navigator remounts and the
  in-app launch splash replays.

**Native rebuild blocked:** `gradlew app:assembleDebug` fails on the
Windows path limit (CMake object paths reach 250 characters under
`android/app/.cxx`; ninja reports "build.ninja still dirty"). So:
- the launcher / adaptive icon is not runtime-verified (only
  `expo prebuild` output and the generated resources were checked);
- the installed binary is still 1.1.3.

| Check | Result |
| --- | --- |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **893/893 passing** |
| `npx tsc --noEmit` | clean |
| `npx expo lint` | 0 errors, 1 existing warning (`services/auth.ts` `fields`) |
| `git diff --check` | clean |
| `npx expo config` | resolves the Design C icons and the adaptive icon |
| `expo export` web / android / ios | all pass |

**Not verified at the 2026-10-02 checkpoint:**
- the launcher icon on device;
- iOS / iPad runtime;
- the device reduce-motion setting (covered by source and tests);
- a real backend 503;
- a real backend-supplied store URL / release notes (the version endpoint
  had not yet been integrated at that checkpoint).

## Post-redesign corrections (product-owner review)

**Runtime target:** Android emulator (`LFA_Phone_API35`: Android 15 / API
35, 1080×2400 @ 420 dpi ≈ 411 dp; also resized to 720×1520 @ 320 dpi ≈ 360 dp
and 1600×2560 @ 320 dpi ≈ 800 dp), the user's dev build, signed in, staging.
No iOS simulator exists on Windows: iOS is source / test / export verified.

**Implemented and Android-runtime verified (signed in, staging):**
- Home "See all" on Latest result → Matches on the Results segment; the
  result card opens Match Details.
- Match result view: Timeline / Stats on the shared sliding control; v3
  "F. LastName" names in the timeline, substitution "Off …" line and
  scorer lines (all five event kinds, match 17).
- Competitions: card shadows no longer clipped; the cup shows the knockout
  note and no table; league table unchanged.
- My Tickets: tapping the ticket surface flips it; the inner "Ticket
  details" button flips exactly once; the raised shadow fades fully (pager
  padding), no hard cut.
- Checkout: BLUE Wallet first, "Other — Debit or credit card" second; no
  provider branding in the card note or card screen.
- A real staging card purchase (test card) completed: order ORD-1028, the
  match's ticket count went 6 → 7, and My Tickets opened that match's viewer
  on the new Zone A ticket. (The success screen itself was not captured;
  focus index 0 was also the list's first ticket.)
- Reservation expiry on the card screen returned to Home with the hold
  cleared (existing behaviour).
- Narrow (≈360 dp) and tablet-width (≈800 dp) layouts of My Tickets,
  Competitions and the result view.

**Implemented, source / test verified only:**
- Live minute ("LIVE 67'", blink only while `clock_running`) on Home, list
  cards and the score card: nothing was live on staging.
- Live "See all" (no live match to show the section).
- Ticket QR / stamp entrance animation (no used / expired / cancelled
  ticket on the account).
- Login / Register without a client-imposed OTP (`credentialOutcome`);
  no account was registered or logged in again during the check.
- BLUE "View my ticket" (`purchasedMatchId` on the in-memory handoff).
- Skeletons in final geometry (Match Details, standings, competition
  matches, ticket stubs, the 600 pt ticket, the cart card).

**Blocked by backend:**
- Notification read state: the inbox and unread-count APIs are read-only (no
  mark-read mutation), so opening a notification never changes it and v3's
  "Mark all as read" is not offered.
- Live minutes on competition match cards: the competition-matches endpoint
  has no clock fields.
- A direct ticket link for multi-match orders: the submit response carries
  no ticket codes or match ids.

**Not verified:** iOS / iPad runtime; BLUE handoff at runtime; a live match;
the reduced-motion setting on the device.

**Request audit (source):** no new requests. Live minutes come from the
existing list responses (no per-card detail fetch, no new polling); cups skip
their standings request; QR detail fetches still only when the list lacks a
usable QR; one reservation timer; Show / Hide map still fetch-free; the
purchased-ticket focus reuses the viewer's single tickets request.

### Pass 2 (reservation lifecycle, payment switching, Stats motion)

**Implemented:**
- One reservation countdown: the global v3 bar (`ReservationHoldBar`) on
  Match Details, holders, Checkout and the Card / BLUE payment screens; Cart
  shows the same `CartContext.secondsLeft` in its v3 card. The legacy
  `AppHeader` / `CartTimer` / `HeaderActions` and `ReservationExpiryNotice`
  are removed.
- v3 "Reservation expired" sheet (`HoldExpiredSheet`) from a minimal
  snapshot taken by `CartContext.expireCart` before clearing (unique match
  ids + whether a payment touched the session). Start again → the one
  match's Match Details, or Matches on Upcoming for several matches; Back to
  home → Home. Both reset to a clean Home stack first.
- Payment switching (final): a BLUE request whose page was left is parked,
  so Other stays payable and BLUE resumes the same URL without resubmitting;
  the "cancel BLUE first" message is removed. Android-verified: BLUE (order
  #1034) → Back → Other opened the card form; → Back → BLUE reopened #1034
  with no second submit; on a fresh session Other → Back → BLUE submitted
  once (#1036). Not run: a card submit after BLUE (no real payment).
- Home avatar: the signed-in user's profile image from `AuthContext`
  (resolved like Profile's), v3 initials without an image or on load failure,
  the person mark when signed out (`homeAvatar`). Android-verified with an
  image; Home makes no `/auth/me` request.
- Card / BLUE payment screens on the v3 `FlowHeader`; the shared alert
  dialog in the v3 dialog presentation.
- Completed match: Stats bars grow from the centre line (v3 `lfBar`), rows
  static; Timeline rows keep `lfEnter`; reduced motion → final state.
- Expiry snapshot published with the clear; Checkout / holders empty-cart
  redirects stand down while it is shown (previously an empty Cart could
  appear under the sheet). `StatePanel` text spans the panel (Android
  dropped "empty" from "Your cart is empty" at tablet width).

**Android-runtime verified (phone ≈411 dp and tablet ≈800 dp):**
- Expiry during Cart (single match) → sheet over Home → Start again → that
  match's Details with a clean selection → Back → Home.
- Expiry on the card screen (two matches) → sheet ("No payment was taken")
  → Start again → Matches on Upcoming.
- Expiry during Checkout → sheet over Home (after the redirect fix);
  Back to home → Home, no navigation warnings.
- Tablet: hold sheet, Checkout, Timeline / Stats, empty Cart.
- One countdown on Cart / holders / Checkout / card screen; the hold
  survives an app reload (restored by `CartContext`).
- BLUE → Other selection switch and Other → Back → BLUE (Continue with BLUE
  enabled; not submitted).
- Stats bars animate from the centre each time Stats is shown.

- Expiry during the BLUE page → WebView closed, sheet over Home with the
  "check My Tickets" copy (a BLUE request had been sent).

**Source / test only:** reduced motion on the device; the Home avatar when
signed out, on image-load failure, and after a change from Profile (the
account's real photo was not modified); iOS.

**Backend-dependent:** BLUE ↔ Other switching itself is implemented in the
app (a BLUE order whose page was left is parked; BLUE resumes it, Other pays
with its own order). The app cannot cancel a pending BLUE order or read its
status: cancelling, status and reconciling an outstanding BLUE order —
especially after another method succeeded for the same reservation — need
backend support (`docs/API_INTEGRATION.md`).
- A resumed BLUE payment keeps the match its order was submitted for
  (`purchasedMatchId` on the pending BLUE record), so success still opens
  that match's tickets; several matches → My Tickets.

## Validation (post-redesign corrections working tree)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 1 existing warning (`services/auth.ts` `fields`) |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **863/863 passing** (incl. resumed-BLUE routing) |
| `git diff --check 75cb896` | clean |
| Web / Android / iOS export | PASS |
| Android emulator runtime (dev build, signed in, staging) | PASS for the items listed above |
| iOS / iPad runtime | NOT VERIFIED (no simulator on Windows) |

## Batch 10 record

### Batch 10 checkpoint (v3, final)

**Implemented (source):**
- **Dead code removed** (no importer; orphaned by redesign commits):
  `AppSwitch`, `Collapsible`, `MatchTicketsHeader`, `MatchSummaryBlock`,
  `MainHeader` (with its source test), and 16 unused `ui.tsx` theme style
  keys (legacy chips, badges, the pre-v3 reservation pill).
- **Signed-out gate:** gated non-tab screens (cart, settings, checkout and
  payment routes) show the `FlowHeader` with Back instead of the legacy
  `MainHeader`, which had no Back (a signed-out deep link was a dead end).
- **RTL:** disclosure and pager arrows (Contact, Legal, Profile, Change
  password, ticket pager, the payment screens' `AppHeader`) use
  `DirectionalChevron`; the alert-dialog close button, password field and
  phone field use start/end props. A rule test forbids fixed left/right
  chevrons.
- **Reduced motion:** every modal sheet fades instead of sliding.
- **Accessibility:** segmented-control segments reach ≥ 44pt on native
  (`hitSlop`); `aria-*` twins added where only `accessibilityState`
  carried state (Remember me, the phone-country button and list radios).
- **Errors:** "Request failed with <status>" can no longer reach users
  (`backendProvidedError`, the password sheet).
- **Web:** `getInitialNotificationData` returns `null` on web (it threw on
  every web start: the dev "Failed to handle initial notification").
- **Shadows:** the remaining legacy `shadow*` styles (toast, stadium zone
  markers, maintenance card, `Card`) use `boxShadow` tokens (the `Card`
  shadow was drawn twice on native).

**Source verified (audit, no change needed):** one reservation timer
(`CartContext`); bounded live revalidation; Show/Hide map is presentation
only; scheduled-only purchasing with the pre-commit status re-read; payment
lock, attempt ownership and same-session cart clearing; avatar ownership;
the `returnTo` allowlist; no startup auth; notification permission only from
"Turn on notifications"; countdowns are `role="timer"` (not live regions);
Arabic falls back to the platform font; no raw exception text in the UI. All
existing transaction, auth, startup, notification, ticket and competition
tests pass unchanged.

**Deliberately not changed:**
- `pointerEvents` props (a web dev-mode deprecation only; tests pin the
  seat-press and splash uses).
- `ProfileDetailModal`, `orderPresentation`, `ticketActions`,
  `profilePdfDownload` (the order-details / PDF capability, kept for a
  future entry point), `CardPaymentPreparationContext`,
  `bluePaymentDiagnostics` (pre-redesign, payment area).
- `@expo/ui`, `expo-glass-effect`: declared, never imported; pre-redesign
  native modules whose removal would change native builds.
- The `CartContext` 1 s tick re-renders every `useCart()` consumer
  (including Match Details during a hold): Phase 4 ownership design, not a
  redesign regression.
- v3-sized controls under 44pt keep their drawn size; native reaches 44pt via
  `hitSlop`, the web pointer target is 34–40px.
- On wide screens the subpage Back sits at the screen edge while content stays
  in a readable column (consistent across subpages).

### Validation (Batch 10, at that checkpoint)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 1 existing warning (`services/auth.ts` unused `fields`) |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **816/816 passing** |
| `git diff --check a046a11` | clean (no untracked files) |
| Web / Android / iOS export | PASS |
| Web runtime, signed out (headless Chrome, staging) | PASS: 13 routes (Home, Matches, Match 4 scheduled GA, Match 17 completed with goal / cards / substitution, Competitions, the My Tickets / Settings / Cart gates, Profile, Auth, Legal, Privacy, Contact) at 320 / 390 / 430 / 768 / 1024 px light and 390 px dark: no horizontal overflow, no unlabeled control, no runtime error; tablet widths keep a bounded column |
| Reserved-seat picker | NOT VERIFIED at runtime (no scheduled seated match on staging today) |
| RTL layout | Arabic enabled; automated/source coverage exists. Physical-device RTL remains NOT VERIFIED. |
| Reduced-motion modal fade | Test-verified (`BottomSheetModal`); not observed on a device |
| Signed-in flows (cart, holders, checkout, card / BLUE handoff, tickets / QR, avatar, settings, logout) | NOT VERIFIED (no staging test account in this environment) |
| Native runtime (iOS / Android) | NOT VERIFIED (no development build or device) |
| Real payment handoff | NOT VERIFIED (no real payments) |

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
  Change password (the `/change-password` screen, v3 `chpw`), Settings, Legal
  and Contact; logout is unchanged.
  `/edit-profile` → `/profile`.
- **Settings:** live push permission plus "Open phone settings" (iOS /
  Android builds only; web shows "Not available" with no action); appearance;
  English/Arabic selector with persisted selection; account deletion in two
  steps (v3 `settings_delete` confirmation → `/delete-account`,
  `delete_verify`, current password; the backend contract is unchanged).
- **Notifications:** Home bell with the backend unread count; `/notifications`
  inbox (v3 `notifs`, read-only); match notifications open Match Details.
- **Auth:** v3 presentation over the unchanged login / register / OTP /
  forgot-password logic; `AuthRequired` returns through
  `getSafeAuthReturnRoute`. No startup auth. *(Superseded 2026-10-06 by the
  Authentication & Recovery batch above.)*
- **Legal / Contact:** public `/legal`, `/legal/privacy`, `/legal/terms`
  (backend text via `legalService`), and `/contact` (`OFFICIAL_CONTACTS`).
  `/about` → `/legal`. Legal was previously auth-gated through About.
- **Documented discrepancies (production wins):**
  - no Gate / Block / price / category on tickets (no such fields);
  - no ticket search;
  - the Payment info / PDF entry points are not shown (they were already
    unreachable, and the modules are kept);
  - Change password / Delete account have no "Forgot password" link (the
    recovery flow is signed-out only), and the change-password hint says the
    user signs in again (production clears the session; v3 says "stay signed in");
  - Delete account copy does not claim tickets and orders are removed (the
    backend semantics are not established here);
  - notification rows add a small fixture line (crests + teams) for match
    notifications;
  - OTP is one field, not six boxes (resolved 2026-10-06: six cells);
  - auth copy is still inline English (resolved 2026-10-06: `auth.*` i18n keys);
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
- **Unused modules:** resolved in Batch 10 (see above).

## Validation (Batches 7–9, at that checkpoint)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 4 warnings (the 3 `MatchSummaryBlock` ones left with that file in Batch 10) |
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
  codes; no favourites or availability in the APIs used; no machine-readable
  "no standings" signal (the cup 404 is indistinguishable from a wrong
  route); `qr_image` representations beyond raster data URIs unconfirmed;
  competition-matches and single-match status can disagree (Match Details
  decides). Event kinds, competitions and standings are integrated.
- **Arabic / RTL:** English/Arabic catalogs and `ar` selection are implemented;
  Arabic uses the platform font. Physical-device RTL, payment-flow testing with
  language changes and authenticated backend translation support remain NOT VERIFIED.
- **v3 carry-overs:** every screen is redesigned; the legacy `muted` colour
  remains in a few non-redesigned surfaces (phone-number field, password
  sheet, toasts, dialogs, CyberSource loading, maintenance screen).
- **Platforms:** iOS runtime unverified; a debug dev client can fail on a very
  slow cold Metro bundle (tooling only).
- **Web (dev):** the "Failed to handle initial notification" message is
  fixed (Batch 10). Remaining dev-only web warnings: the `pointerEvents`
  prop deprecation, the native-driver fallback, and the
  `expo-notifications` push-token listener notice.
- **Unused modules (kept deliberately):** `CardPaymentPreparationContext`,
  `ProfileDetailModal` with `orderPresentation` / `ticketActions` /
  `profilePdfDownload`, `bluePaymentDiagnostics`, unused push-token helpers,
  `profileService.orders()`. The dependencies `@expo/ui` and
  `expo-glass-effect` are declared but never imported.
- **Security and backend** concerns remain tracked in `docs/SECURITY.md` §3 and
  `docs/API_INTEGRATION.md` §14.
