# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check the "as of" data against `git log` / `git status` before
> relying on it. Like all docs here, it is edited only with explicit user
> authorization (`AGENTS.md` §4).

**As of:** 2026-09-24 · governance/documentation establishment

---

## Repository snapshot

| Item | Value |
| ---- | ----- |
| Branch | `main` |
| HEAD at start of inspection | `1248c16` — "android notification permission" |
| HEAD at end of documentation task | `d679b85` — "agents docs" (user commit made during the task) |
| Working tree after task | 7 governance files modified (uncommitted): `AGENTS.md`, `CLAUDE.md`, `docs/API_INTEGRATION.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/STATUS.md`, `docs/WORKFLOW.md` |
| Unrelated local file | `.claude/settings.local.json`: untracked local Claude configuration (last modified before this task). It shows as `??` unless a user-level global gitignore hides it. Not part of the governance work, not modified by it, and must not be staged with it. |

At the start of inspection the tree held uncommitted user changes: Expo patch
bumps in `package.json` / `package-lock.json` (`expo` ~57.0.24, `expo-router`
~57.0.22, `expo-notifications` ~57.0.20, `@expo/ui`, `expo-image-picker`,
`expo-sharing`) and earlier governance drafts. The user committed both in
`d679b85`. The current docs replace those drafts.

The validation results below were taken on the pre-commit tree. The only
difference is those same package bumps, now committed.

---

## Redesign stage

- ✅ Governance and documentation established (this task).
- ▶ **Next: Phase 0 — Baseline / redesign readiness** (`docs/WORKFLOW.md` §4).
- `PASS — READY FOR REDESIGN` has **not** been claimed. That gate belongs to Phase 0.

---

## Validation observed during documentation (not a Phase 0 verdict)

Commands were run read-only on the tree described above, Node v24.20.0.

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npx expo lint` | 0 errors, 5 warnings (unused variables, incl. `fields` in `src/services/auth.ts`) |
| `node --test $(git ls-files '*.test.mjs')` | 457 tests: **448 pass, 9 fail** |
| `npx expo config`, web/Metro bundle, device runtime | Not run |

Known failing tests (not yet diagnosed; most are source-text assertions that
may have drifted from intentional code changes — Phase 0 must decide which):

| File | Test |
| ---- | ---- |
| `src/components/CheckoutPaymentResult.test.mjs` | success and failure actions preserve labels and destinations |
| `src/components/MatchesList.accessibility.test.mjs` | clear filters remains a distinct labeled button |
| `src/lib/checkoutSubmissionAuthority.test.mjs` | checkout source retains synchronous duplicate-submit protection |
| `src/lib/checkoutSubmissionAuthority.test.mjs` | returning from BLUE releases the route-launch guard and reuses the same session attempt |
| `src/lib/checkoutSubmissionAuthority.test.mjs` | background Checkout cannot replace authoritative Card success with Cart |
| `src/lib/contact.test.mjs` | official contact destinations remain centralized and allowlisted |
| `src/lib/contact.test.mjs` | social contacts use real brand glyph authorities instead of generic substitutes |
| `src/lib/rootNavigation.test.mjs` | bottom navigation ignores the active root and replaces a different root |
| `src/services/authRecoveryContracts.test.mjs` | forgot-password service methods use the exact paths and payload field names (expects `password-confirmation`; code sends `password_confirmation`) |

Three failures sit in checkout/payment-guard tests. Treat them as
regression-critical until diagnosed.

---

## Known blockers

None block starting Phase 0. Before visual work begins (end of Phase 0):

- the 9 failing tests must be reconciled,
- the localization/RTL approach must be decided (none exists today),
- security concern §3.1 (client-visible API credential) needs an explicit
  decision: accept for now, or schedule remediation.

---

## Deferred security concerns

Recorded in `docs/SECURITY.md` §3 and intentionally **not** fixed during the
documentation task: client-visible API credential (§3.1), open web proxy (§3.2),
web token in `localStorage` (§3.3), client-inferred BLUE success (§3.4), card
success on any 2xx (§3.5), permissive BLUE WebView navigation (§3.6),
CyberSource config fallbacks (§3.7), displayable success deep links (§3.8), no
device detach on logout (§3.9), non-secure user record (§3.10), dev logging /
temporary diagnostics (§3.11), sticky maintenance (§3.12), Android cleartext
unknown (§3.13).

---

## Phase 0 investigation targets

- Diagnose each failing test: real regression, intentional drift, or wrong test.
- Resolve the reset-password field contract (`password_confirmation` vs
  `password-confirmation`) against the backend.
- Run `npx expo config` for each EAS profile; confirm the ATS logic and the
  production BLUE-origin guard.
- Web: `npx expo start --web` / export; verify Metro resolution of
  `.native`/`.web` splits and the `/api` proxy.
- Confirm backend behavior for declined card payments, BLUE finalization
  (including on web), and checkout submit idempotency.
- Confirm backend ticket `status` values, and whether live/results data exists,
  before designing those states.
- Decide on unused modules (`CardPaymentPreparationContext`,
  `ProfileDetailModal`, `bluePaymentDiagnostics`, unused push-token helpers,
  `GET /portal/orders`): keep, wire up, or remove in a scoped task.
- Record the regression-critical manual flows and the devices/sizes to verify them on.
- Decide the localization/RTL mechanism and whether it moves into Phase 1
  (`docs/WORKFLOW.md` §4 note).
