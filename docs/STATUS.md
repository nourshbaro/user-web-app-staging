# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-09-28 · Phase 4 closure (documentation sync)

---

## Stage

- ✅ Phase 0 — Baseline / redesign readiness (`e64a150`).
- ✅ Phase 1 — Design Foundations (`3863673`).
- ✅ Phase 2 — Navigation + Home + Match Discovery (`125ee2f`).
- ✅ Phase 3 — Match Details + Ticket Selection (`cf987f3`).
- ✅ **Phase 4 — Cart + Checkout: code-complete, pending commit.** Reviewed
  independently; the confirmed findings (payment lock across restart, expiry
  during the card handoff, same-session Card/BLUE concurrency) are fixed. The
  changes are uncommitted on `cf987f3`.
- ▶ **Next:** the redesign plan against the approved v2 design reference,
  starting with its first batch once approved (`docs/WORKFLOW.md` §4–§5).

---

## Validation (Phase 4 working tree)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 5 existing unused-variable warnings |
| Tests (`AGENTS.md` §13 command, incl. untracked) | 66 files, **686 / 686 pass** |
| `git diff --check` | clean |
| Android / iOS / web exports | NOT RUN in the Phase 4 closure round |
| Phase 4 runtime (Android, web) | NOT VERIFIED — see below |
| iOS runtime | NOT VERIFIED (Windows environment) |

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
  codes; no live data, results, favourites or availability in the APIs used;
  competitions/standings endpoints are not integrated yet.
- **Arabic / RTL:** no Arabic translation, and `ar` is not enabled.
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
