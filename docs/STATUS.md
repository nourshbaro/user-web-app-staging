# `docs/STATUS.md`

```md
# Project Status — LFA User Mobile App

## Current Initiative

UI/UX REDESIGN OF EXISTING PRODUCTION APP

The current repository remains the implementation foundation.

A generated Expo application has been reviewed as a design/UX reference.

Decision:

**Mine it for patterns, not architecture.**

---

## Current Redesign Direction

Approved conceptual patterns include:

- stronger match-first home,
- featured/dark match presentation,
- clearer live/upcoming/past segmentation,
- improved match cards,
- skeleton loading,
- useful empty/error states,
- better ticket presentation,
- QR-first ticket hierarchy,
- sticky totals/actions where appropriate,
- improved Arabic/RTL treatment,
- coherent semantic visual system.

Rejected:

- wholesale replacement,
- mock architecture,
- fake tickets,
- fake payment behavior,
- fake QR behavior,
- hardcoded production data,
- random generated IDs,
- new in-memory domain authority,
- unnecessary route/state replacement.

---

## Redesign Gate

Before broad visual implementation, verify that the current baseline is stable.

Phase 0 should establish:

- known repository state,
- test baseline,
- TypeScript baseline,
- lint baseline,
- Expo/config baseline,
- relevant web/Metro behavior,
- localization dependency compatibility,
- known client-visible credential/security concerns,
- currently known functional defects that would make redesign validation unreliable.

Do not mix unrelated baseline repair with redesign unless required.

Target gate:

`PASS — READY FOR REDESIGN`

---

## Redesign Phases

### Phase 0 — Baseline / Architecture Verification

Status: CURRENT / GATE

Goals:
- establish trustworthy baseline,
- document existing ownership,
- isolate known technical defects,
- confirm redesign boundaries.

### Phase 1 — Foundations

Planned:
- design tokens,
- spacing,
- typography,
- surfaces,
- shared states,
- common buttons/controls,
- accessibility baseline,
- RTL conventions.

Avoid broad route redesign during foundation work.

### Phase 2 — Navigation + Home / Match Discovery

Planned:
- navigation presentation,
- home hierarchy,
- featured match,
- fixtures/match cards,
- live/upcoming/completed states,
- loading/empty/error states.

### Phase 3 — Match Details + Ticket Selection

Planned:
- match hero,
- match information,
- ticket availability,
- zone/ticket selection presentation,
- sticky transaction summary/action where appropriate.

### Phase 4 — Cart / Checkout

Planned:
- cart presentation,
- holder/customer information,
- checkout clarity,
- validation,
- payment selection presentation,
- transaction-safe loading/error states.

Business/payment behavior must remain authoritative.

### Phase 5 — Tickets

Planned:
- ticket list,
- active/upcoming/history distinctions where supported,
- QR-first detail,
- ticket lifecycle states,
- match/seat information hierarchy.

### Phase 6 — Profile / Supporting Screens

Planned:
- profile,
- edit profile,
- settings,
- notifications,
- secondary/supporting flows.

### Phase 7 — Cross-App Polish

Planned:
- RTL verification,
- accessibility pass,
- tablet/responsive pass,
- reduced-motion review,
- visual consistency,
- regression checks,
- performance review.

---

## Agent Model

Primary implementer:
**Claude Code**

Independent verifier / targeted inspector:
**Codex**

Coordinator and requirements authority:
**User + ChatGPT**

User retains final approval and commit authority.

---

## Current Principle

A screen is not considered redesigned because it matches a screenshot.

It is complete only when real application behavior still works.
```

---

