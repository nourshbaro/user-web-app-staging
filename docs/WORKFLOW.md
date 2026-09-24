# Workflow — LFA User App

How work is scoped, implemented, verified, and committed in this repository.
Governing rules are in `AGENTS.md`; this document describes the process.

---

## 1. Roles

| Role | Responsibility |
| ---- | -------------- |
| **User** | Requirements owner and final authority: scope, design direction, acceptance, documentation changes, commits. |
| **ChatGPT** (with the user) | Coordination: turns requirements into scoped tasks, routes work to agents, reconciles findings. |
| **Claude Code** | Primary implementation and design-engineering agent. Does most of the implementation. |
| **Codex** | Independent verifier and targeted inspector: diff review, drift detection, checks, focused investigations, and mechanical fixes when explicitly assigned. |

Claude should be used substantially more than Codex for implementation.
Codex does not re-implement reviewed work to suit its own preference.

---

## 2. Default workflow for a substantial feature

1. **Scope** — User + ChatGPT define one coherent batch and its acceptance criteria.
2. **Read** — Claude reads `AGENTS.md`, `CLAUDE.md`, `docs/STATUS.md`, and the relevant docs.
3. **Inspect** — Claude inspects the implementation (route, components, state
   owner, services, types, persistence, tests, states, security) and states
   ownership and intended scope before editing.
4. **Implement** — Claude implements the whole batch coherently.
5. **Verify and report** — Claude runs the relevant checks and reports with
   the `CLAUDE.md` completion format, including what was not runtime-verified.
6. **Independent review** — Codex performs **one** fresh-context review of the result.
7. **Fix** — Confirmed findings go back to Claude, who verifies each finding,
   applies the narrowest correct fix, and re-runs the affected checks.
8. **Final verification** — Targeted re-check of the fixes (Codex or checks).
   Outcome: `PASS` or `PASS WITH NOTES`. A note must not hide a blocker.
9. **Runtime review** — The user exercises the real app: appearance,
   interaction, phone and tablet sizes, keyboard, loading/error states, real
   backend data, the transaction flow, and dark mode.
10. **Commit** — Only after the user approves.

### Review findings

Codex classifies findings as BLOCKER / HIGH / MEDIUM / LOW / NOTE with file and
line evidence and a concrete failure scenario. Only confirmed or strongly
evidenced issues block progress. Style preferences are not findings.

### Avoid

- Endless Claude ↔ Codex loops. The default is implement → one review → fix → final check → stop.
- Micro-phases (`MD-01A`, `MD-01B`, …) created for ceremony.
- Unrelated refactors or "while I'm here" cleanup.
- Splitting an implementation only to make the process look careful.

---

## 3. Task sizing

Prefer coherent batches, for example:

- Design Foundations
- Navigation + Home + Match Discovery
- Match Details + Ticket Selection
- Cart + Checkout
- My Tickets
- Profile (+ settings, edit profile, about)
- Localization / RTL / Accessibility / Responsive polish

Split only at a genuine boundary:

- **architecture** — a change to an owner, provider tree, or routing semantics,
- **security** — auth, token, WebView, deep link, config, or credential behavior,
- **transaction** — checkout submission, payment completion, or cart clearing,
- **ownership** — the work crosses independently owned domains,
- **verification risk** — too large to review or runtime-test reliably at once.

Example: "Cart + Checkout" is one presentation batch. A change to *when* the
cart is cleared after payment is a separate transaction-boundary task.

---

## 4. Redesign roadmap

The redesign happens in place, phase by phase. Each phase is a batch (or a few
batches) run through §2.

### Phase 0 — Baseline / redesign readiness ← **NEXT**
Before significant visual change:
- confirm Git state and isolate pre-existing work,
- reconcile the known failing tests (`docs/STATUS.md`) — fix, update with
  justification, or document as accepted,
- TypeScript, lint, and Expo config baselines,
- web / Metro compatibility,
- review the open security concerns (`docs/SECURITY.md` §3) and decide which
  block the redesign,
- identify regression-critical flows and how each will be verified
  (auth, add-to-cart GA and seated, expiry, BLUE, card, tickets/QR, PDF, push),
- decide the localization/RTL approach (see note below).
No unrelated refactors. Exit criterion: a credible `PASS — READY FOR REDESIGN`.

### Phase 1 — Design foundations
Semantic tokens (extending `src/lib/themePalette.ts`), typography, surfaces,
spacing, radii, status badges, section headers, skeletons, state panels
(loading/empty/error), a sticky transaction bar, the ticket-card foundation, an
accessibility baseline, and RTL-safe layout conventions.

### Phase 2 — Navigation + Home + Match Discovery
### Phase 3 — Matches + Match Detail + Ticket Selection
### Phase 4 — Cart + Checkout
### Phase 5 — Tickets
### Phase 6 — Profile + supporting screens
### Phase 7 — Localization / RTL / Accessibility / Responsive / Performance / regression polish

**Roadmap boundary note (pending user decision).** Inspection found no
localization or RTL infrastructure (`docs/ARCHITECTURE.md` §15). If Arabic is a
launch requirement, placing all localization in Phase 7 means extracting every
hardcoded string after Phases 2–6 have rewritten those screens. The suggested
alternative is to decide the i18n/RTL mechanism in Phase 0 and introduce it in
Phase 1, so Phases 2–6 build localized, RTL-safe screens, and Phase 7 becomes
verification and polish. This is a recommendation only; the roadmap above stays
as written until the user decides.

---

## 5. Using the generated reference project

Location: `C:\Users\noorsh\Documents\BLUE\claude gen AI lfa ui` (outside this repo, not under Git).

For each idea you adopt:

1. name the UX idea and why it helps,
2. inspect how production handles that feature today,
3. adapt the idea to the existing route, owner, and service,
4. back it with real API data and real state,
5. verify with the real backend.

Good: *"Adopt the reference's dark match hero on `/match/[id]`, fed by
`matchesService.details`."*
Bad: *"Copy the reference's `buy/` routes, Zustand store, and mock data."*

### 5.1 Approved concepts (presentation only)

- football-first hierarchy; featured-match emphasis; dark match hero
- visible bottom-navigation labels (production items are icon-only with
  accessibility labels; making labels visible is Phase 2 work)
- clearer match states; Upcoming / Live / Results **only where the backend
  supports them** (discovery currently uses scheduled matches only)
- compact date browsing; a focused filter bottom sheet (existing filters:
  team, stadium, date)
- stronger skeleton/loading, empty, and error states
- persistent transaction total/action areas
- stronger payment-option presentation for the **real** methods (Card via
  CyberSource, BLUE Wallet)
- Upcoming / Used / Expired tickets **where supported** (portal filter is
  `all | upcoming | past`; ticket `status` and `checked_in_at` are the real signals)
- QR-first ticket detail using the backend `qr_image`
- stronger profile grouping
- Arabic/RTL-aware design (after the localization decision)
- improved typography; semantic design tokens

### 5.2 Rejected implementation patterns

Production must not inherit:

- fake authentication; fake payment processing; fake card entry
- fake or generated production QR codes (the reference's hash-seeded `qrCells`)
- random order/ticket IDs (the reference uses `Math.random`)
- mock production data (`src/data/mock.ts`)
- synthetic stadium ownership (N/W/E/S stands) replacing backend zones and maps
- an in-memory purchase store replacing `CartContext` / server state
- fake notifications or push simulations
- artificial network delays (timed "processing" screens)
- demo toggles or demo/states routes
- payment methods the backend does not support
- uncontrolled decorative animation; any animation without reduced-motion handling
- wholesale replacement of routes (`(tabs)`, `buy/*`), stores, or component architecture
- new dependencies added only to reproduce reference visuals (e.g. a state
  library or font packages) without a separate justification

---

## 6. Git workflow

- **No automatic commits.** Commit, push, amend, or rebase only when the user instructs it.
- **Before work:** run `git status --short`; record pre-existing changes.
- **Preserve pre-existing changes:** do not revert, reformat, stage, or absorb them.
- **Before a proposed commit:** show `git status`, the changed-file list, and
  the relevant diff; confirm unrelated work is excluded.
- **Report checks** with exact results (e.g. "tests 458/458 pass, 48 files").
- **Disclose** anything not runtime-verified.
- One coherent change per commit, conventional style, for example
  `feat(app): redesign match details experience` or
  `fix(app): address checkout redesign regressions`.

---

## 7. Evidence standard

Reports cite files and lines, commands and outputs, or runtime observations.
Use CONFIRMED / HIGH-CONFIDENCE / POSSIBLE / NOT VERIFIED where certainty
matters. "Everything looks good" is not a report.

---

## 8. Documentation changes

Documentation is read-only by default (`AGENTS.md` §4). At the end of a phase,
Claude or Codex may **propose** STATUS or doc updates in their report. The
user decides whether to authorize them. Only then are the files edited.
