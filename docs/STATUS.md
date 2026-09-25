# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-09-25 · Phase 2 final documentation sync

---

## Stage

- ✅ Phase 0 — Baseline / redesign readiness (`e64a150`).
- ✅ Phase 1 — Design Foundations (`3863673`).
- ✅ **Phase 2 — Navigation + Home + Match Discovery: COMPLETE, pending
  commit.** Independently reviewed; the focused corrections are applied. The
  changes sit uncommitted on `3863673`.
- ▶ **Next: Phase 3 — Matches + Match Detail + Ticket Selection** (`docs/WORKFLOW.md` §4).

---

## Validation (current working tree)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 5 existing unused-variable warnings |
| Tests (`AGENTS.md` §13 command) | 57 files, **560 / 560 pass** |
| `expo-doctor` | 21/21 |
| `npx expo install --check` | Dependencies up to date |
| Android + iOS Metro export | PASS |
| Web export (server output, incl. `/api`) | PASS |
| Android runtime (Hermes, EAS dev build `4e8937cd`, Pixel_9a emulator, staging data) | PASS: Home hero and upcoming; featured aging on foreground and at the kickoff timer; tabs; filter sheet; offline filter switch → error → retry; rapid filter switching; Clear; card → match tickets → back; 360 dp narrow layout |
| Web runtime (Expo dev server, staging data) | PASS: Home and Matches at 820 and 1280 px, dark theme |
| iOS runtime | NOT VERIFIED (Windows environment) |

Export and runtime results come from the Phase 2 correction round. No source,
package or config changed afterwards.

---

## Phase 2 outcome

- **Navigation:**
  - visible tab labels, with a non-colour selected indicator;
  - `navigateToTab` / replace semantics unchanged;
  - RTL-aware tab swipe and entrance motion.
- **Home:** a football-first layout: banner, featured-match hero (earliest
  valid future kickoff), and up to 4 upcoming matches. Past and unknown-time
  fixtures are excluded, and the feature ages via `useKickoffClock` (no
  polling).
- **Matches:**
  - a filter bar with active count and chips, plus a filter sheet with inline
    calendar;
  - filters apply immediately, and "Done" closes the sheet;
  - global empty and filtered empty are distinct states.
- **Data integrity:**
  - one shared loading owner, `useScheduledMatches`, with synchronous request
    invalidation and filter-tagged results;
  - a failed filter change never shows old results as new;
  - strict kickoff parsing: invalid or missing kickoffs are unknown, never
    midnight;
  - a blank status shows a neutral "Status unavailable".
- **Fix:** `phoneNumber.ts` imports `i18n-iso-countries/index.js`, which fixes
  web server rendering and the dev server.

---

## Deferred (non-blocking) findings

- **Backend contracts:** the kickoff timezone is unresolved (read as local
  wall-clock time). Live, results, standings, competitions, favourites and
  availability all need backend support.
- **Arabic / RTL:** no Arabic translation, and `ar` is not enabled. RTL visuals
  and the native direction-transition reload are not runtime-tested.
- **Platforms:** iOS runtime is unverified. A debug dev client can fail on a
  very slow cold Metro bundle; pre-warming the bundle avoids it (tooling only).
- **Legacy screens:** screens not yet redesigned still use the old `muted`
  colour and the `accessibilityState` object; they are migrated as they are
  redesigned.
- **Unused modules:** keep until a scoped cleanup (`CardPaymentPreparationContext`,
  `ProfileDetailModal`, `bluePaymentDiagnostics`, unused push-token helpers,
  `profileService.orders()`).
- **Security and backend** concerns remain tracked in `docs/SECURITY.md` §3 and
  `docs/API_INTEGRATION.md` §14.
