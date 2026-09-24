# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-09-24 · Phase 0 closed

---

## Stage

- ✅ Governance established (`4253605`).
- ✅ **Phase 0 — Baseline / redesign readiness:**
  `PASS WITH DEFERRED NON-BLOCKING FINDINGS — READY FOR REDESIGN`
- ▶ **Next: Phase 1 — Design Foundations** (`docs/WORKFLOW.md` §4).

Phase 0 changes were made on top of HEAD `4253605` (`main`). Check `git log`
for whether they have since been committed.

---

## Validation baseline (end of Phase 0)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 5 existing unused-variable warnings |
| Tests (`AGENTS.md` §13 command, 48 files) | **458 / 458 pass** |
| `expo-doctor` | 21/21 during Phase 0; at closure 20/21 — see note |
| `npx expo install --check` | Aligned during Phase 0; at closure one patch drift — see note |
| Android + iOS Metro export | PASS |
| Web export (server output, incl. `/api`) | PASS |
| Web runtime (headless Chrome) | PASS after the notification guard fix |
| Native device runtime, push on device, EAS build | NOT VERIFIED |

**Dependency drift note:** `expo-sharing@57.0.22` was published upstream on
2026-09-24 (10:15 UTC), after the Phase 0 checks. The project pins
`~57.0.21`. `package.json` and the lockfile are unchanged. Aligning it is a
separate one-package task (`npx expo install expo-sharing`), not done here.

---

## Phase 0 outcomes

- Reconciled all 9 original test failures:
  - 7 stale or over-broad source assertions (checkout guards, result
    destination, clear-filters scope, bottom-nav delegation), each verified
    against current behavior
  - the reset-password test now expects `password_confirmation`, matching
    the code and the sibling `user-web` client
  - 2 contact tests updated to the product decision below
- **Product decision:** Profile contacts are WhatsApp + Email only;
  Instagram, Facebook and X stay removed.
- **Fixed a web startup crash:** `subscribeToFcmTokenRefresh` is now a no-op
  off native (React Native Firebase has no default app on web). A regression
  test was added (`src/lib/notifications.test.mjs`).

---

## Deferred (non-blocking) findings

- **Security:** all items in `docs/SECURITY.md` §3, notably the client-visible
  API credential (native **and web** client bundles), the open web proxy, the
  web token in `localStorage`, and redirect-inferred BLUE success. These need
  backend/infrastructure coordination.
- **Backend contracts** (`docs/API_INTEGRATION.md` §14):
  - declined-card HTTP status — unresolved; the sibling web tests assume 402
  - checkout idempotency
  - full ticket status set — affects Phase 5 "Used" state
  - live/results data — affects Phase 2 states
  - `remember` semantics
  - BLUE on this app's web build ends on the separate `user-web` site (per the configured redirect origins)
- **Unused modules** (keep until a scoped cleanup task):
  - `CardPaymentPreparationContext` — dead
  - `ProfileDetailModal` — dead; only a source test still reads it
  - `bluePaymentDiagnostics` — temporary, unused
  - unused Expo/device push-token helpers
  - `profileService.orders()` — dormant
- **Accessibility primitive gaps** and **localization/RTL foundations** are
  Phase 1 scope (`docs/ARCHITECTURE.md` §14–§15).
