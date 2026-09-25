# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-09-25 · Phase 1 final verification

---

## Stage

- ✅ Phase 0 — Baseline / redesign readiness (`e64a150`).
- ✅ **Phase 1 — Design Foundations: COMPLETE, pending commit.** The changes
  (foundations, docs, and the current working-tree Expo patch alignment in
  `package.json` / `package-lock.json`) sit uncommitted on `e64a150`.
- ▶ **Next: Phase 2 — Navigation + Home + Match Discovery** (`docs/WORKFLOW.md` §4).

---

## Validation (current working tree)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 5 existing unused-variable warnings |
| Tests (`AGENTS.md` §13 command) | 54 files, **509 / 509 pass** |
| `expo-doctor` | 21/21 |
| `npx expo install --check` | Dependencies up to date (the Expo 57 patch alignment is applied) |
| `npm ls` | Clean |
| Android + iOS Metro export | PASS |
| Web export (server output, incl. `/api`) | PASS; headless-Chrome startup PASS (`lang="en-US"`, `dir="ltr"`) |
| Android native runtime (Hermes, EAS dev build `4e8937cd` on the Pixel_9a emulator) | PASS: Home renders staging data, tab navigation works, no JS/route/localization errors |
| iOS native runtime | NOT VERIFIED (Windows environment) |
| Native RTL direction transition on a device | NOT VERIFIED (unit-tested only) |

---

## Phase 1 outcome

- **Tokens:** semantic color roles and status tones, with an AA contrast test,
  plus spacing, radius, size, layout and typography scales (`designTokens.ts`).
- **Localization:**
  - an English-only i18n foundation: the `lfa_locale` app setting, a catalog,
    a translator, and internal CLDR plural rules (no `Intl.PluralRules`,
    which Hermes lacks);
  - a restart-aware direction lifecycle with loop prevention;
  - locale-aware formatters, including "Price unavailable" for invalid money.
- **Accessibility:** `Button`, `Input`, `Loading`, bottom-nav tabs and
  `StatePanel` corrected; `aria-*` props for state.
- **Foundation components:** `AppText`, `SectionHeader`, `StatusBadge`,
  `StatePanel`, skeletons, a presentation-only `TransactionBar`, ticket
  primitives, `PhysicalLayout`, and `DirectionalChevron`.
- **Physical layouts:** stadium and seat maps pinned LTR.

---

## Deferred (non-blocking) findings

- **Arabic:** full translation not implemented and `ar` not enabled; the
  Arabic numerals decision is open.
- **RTL:** the Arabic/RTL device flow and the native direction-transition
  reload are not runtime-tested. Primary-tab swipe and entrance motion are not
  RTL-aware yet (Phase 2).
- **Legacy screens:**
  - the old `muted` color (about 3.6:1 on white) fails the contrast target;
  - some use the `accessibilityState` object, which react-native-web ignores.
  - Both are migrated as screens are redesigned.
- **Tooling:** the `i18n-iso-countries` dev-server-only issue is still to be
  investigated. iOS runtime is unverified.
- **Unused modules:** keep until a scoped cleanup (`CardPaymentPreparationContext`,
  `ProfileDetailModal`, `bluePaymentDiagnostics`, unused push-token helpers,
  `profileService.orders()`).
- **Security and backend** concerns remain tracked in `docs/SECURITY.md` §3 and
  `docs/API_INTEGRATION.md` §14.
