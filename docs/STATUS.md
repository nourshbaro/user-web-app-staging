# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-09-29 · v3 Redesign Batches 1–3 (implementation checkpoint)

---

## Stage

- ✅ Phase 0 — Baseline / redesign readiness (`e64a150`).
- ✅ Phase 1 — Design Foundations (`3863673`).
- ✅ Phase 2 — Navigation + Home + Match Discovery (`125ee2f`).
- ✅ Phase 3 — Match Details + Ticket Selection (`cf987f3`).
- ✅ Phase 4 — Cart + Checkout (`bc4ca08`).
- ✅ **v3 Batches 1–3 — Foundation + navigation, Splash/onboarding/
  notifications, Home + Matches: implemented, pending independent review.**
  Uncommitted on `bc4ca08`. Design reference: LFA Screen v3
  (`docs/WORKFLOW.md` §5).
- ▶ **Next:** Codex checkpoint review of Batches 1–3; then Batch 4 (Match
  Details / ticket selection on v3: map collapsed by default with Show/Hide,
  existing map geometry authoritative).

---

## Validation (Batches 1–3 working tree)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 5 existing unused-variable warnings |
| Tests (`AGENTS.md` §13 command, incl. untracked) | **750/750 tests passing (74 files)** |
| `git diff --check` | clean |
| Web export (server output, incl. `/api`) | PASS |
| Android + iOS Metro export | PASS (7 font files bundled) |
| Web runtime (dev server, headless Chrome, staging data) | PASS: Home and Matches at 390 px and 820 px, light and dark, reduced motion; tab order and `aria-selected`; `/tournament` → `/competitions` |
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
  disappears at expiry (toast from `ReservationExpiryNotice`); absent on
  `/cart`, `/checkout/*`, `/match/[id]`; status bar not covered.
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
  Live now / Latest result are display-only (no result screen yet); the hold
  bar stays off Match / Cart / Checkout until those are redesigned (Batch 4+);
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
- **Reserved seats:** the runtime path still needs a seated staging fixture;
  the 5-minute seat cache can age (the backend add stays authoritative).
- **Backend contracts:** kickoff timezone unresolved; no structured error
  codes; no live data, favourites or availability in the APIs used;
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
  `profileService.orders()`).
- **Security and backend** concerns remain tracked in `docs/SECURITY.md` §3 and
  `docs/API_INTEGRATION.md` §14.
