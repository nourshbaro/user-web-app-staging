# `AGENTS.md`

```md
# LFA User Mobile App — Agent Instructions

## 1. Project Identity

This repository is the production LFA consumer mobile application.

Technology:
- React Native
- Expo
- TypeScript
- Expo Router

This application is part of the wider LFA Ticketing System.

Related products exist, including:
- User Web
- Admin
- POS
- Check-in
- Backend services

Do not assume behavior from another LFA application applies here unless verified against this repository and its API contract.

---

## 2. Current Objective

The current major initiative is a UI/UX redesign of `user-web-app`.

IMPORTANT:

This is a redesign of the EXISTING production application.

It is NOT:
- a rewrite,
- a replacement application,
- a migration to the generated prototype,
- an excuse to replace established architecture,
- an opportunity to redesign backend contracts.

The existing repository remains the engineering foundation.

A separately generated Expo application was reviewed as a DESIGN REFERENCE ONLY.

Its architecture, mock services, state model, fake payment flows, fake QR data, fake tickets, generated IDs, and route structure are NOT authoritative.

Use that reference to identify useful UX patterns, not implementation architecture.

---

## 3. Redesign Principle

Use:

    EXISTING PRODUCTION ENGINEERING
                +
      SELECTED NEW UX PATTERNS
                =
        REDESIGNED APPLICATION

Never:

    GENERATED PROTOTYPE
          ↓
    REPLACE REAL APP

Preserve working production behavior unless the task explicitly requires changing it.

---

## 4. Patterns Approved for Selective Reuse

The redesign may reuse or adapt concepts such as:

- match-first information hierarchy,
- stronger featured-match presentation,
- dark match hero sections,
- clearer upcoming/live/past status segmentation,
- improved fixture and match cards,
- skeleton loading states,
- purposeful empty states,
- clear error/retry states,
- sticky purchase summaries or CTAs where appropriate,
- QR-first ticket presentation,
- improved ticket lifecycle/status presentation,
- better visual hierarchy,
- consistent spacing and semantic design tokens,
- clearer navigation labels,
- Arabic/RTL-aware layout patterns,
- restrained transitions and animation,
- improved accessibility,
- responsive layouts for phones and tablets.

These are concepts.

Do not copy generated architecture blindly.

---

## 5. Explicitly Rejected Patterns

Do NOT introduce:

- fake tickets,
- fake QR codes,
- fake payment completion,
- fake authentication,
- random IDs standing in for backend IDs,
- hardcoded mock production data,
- in-memory-only production state,
- duplicate sources of truth,
- replacement routing architecture without necessity,
- a monolithic global store merely because the prototype uses one,
- new API contracts invented by the frontend,
- unnecessary wrappers or abstractions,
- nested pressable controls with conflicting interaction behavior,
- fixed layouts that fail on smaller phones,
- fixed grids that fail on tablets or RTL,
- excessive animation,
- decorative UI that interferes with ticket purchasing,
- unnecessary dependencies simply to reproduce prototype visuals.

---

## 6. Architecture Preservation Rules

Before modifying a feature, identify its current owner.

Examples of ownership that must be preserved unless explicitly changed:

- authentication state,
- authenticated API token handling,
- profile/user state,
- cart state,
- checkout state,
- order state,
- BLUE payment lifecycle,
- payment redirects,
- ticket retrieval,
- QR/ticket presentation,
- push notification registration,
- deep-link / navigation behavior,
- localization,
- theme,
- persisted state.

Do not create a second owner for existing state.

Do not duplicate API calls in presentation components.

Do not move business logic into UI components merely because the redesigned UI needs different presentation.

Prefer:

    existing domain/state/service
            ↓
      redesigned component

rather than:

    redesigned component
            ↓
    new duplicated logic

---

## 7. API Rules

Treat existing backend APIs as external contracts.

Before changing an API interaction:

1. Inspect the existing service implementation.
2. Inspect all call sites.
3. Inspect related types.
4. Inspect tests.
5. Determine request authentication requirements.
6. Determine request/response ownership.
7. Determine failure behavior.
8. Determine whether retry/idempotency matters.

Do NOT:
- invent missing endpoints,
- silently change payloads,
- expose secrets,
- move privileged credentials into client code,
- treat UI assumptions as backend guarantees.

See:

`docs/API_INTEGRATION.md`

---

## 8. Security Rules

Security behavior is not redesignable decoration.

Preserve security-sensitive flows.

Special attention is required around:

- bearer/auth token handling,
- credentials,
- checkout,
- order creation,
- BLUE payment,
- payment completion,
- payment retries,
- QR/ticket authenticity,
- device registration,
- notification handling,
- user identity,
- persisted sensitive information.

Never infer successful payment merely from presentation state.

Never generate a client-side fake success.

Never expose secrets in the app bundle.

Never weaken native/platform security to make a flow appear functional.

See:

`docs/SECURITY.md`

---

## 9. BLUE Payment Invariants

Payment behavior must be treated as transactional functionality.

A redesign may alter presentation but must not casually alter:

- order creation,
- pending-order handling,
- payment URL ownership,
- WebView/payment handoff,
- callback handling,
- success/failure/cancellation behavior,
- retry semantics,
- cart cleanup timing,
- completed order identification.

Do not clear checkout/cart state before success is authoritative.

Do not create duplicate orders merely because a user retries a payment.

Any payment behavior change requires focused inspection and verification.

---

## 10. Ticket / QR Rules

Real ticket and QR behavior must remain connected to authoritative backend data.

Do not:

- fabricate QR values,
- use decorative QR codes as functional tickets,
- generate fake ticket IDs,
- replace backend lifecycle/status information with UI-only assumptions.

The redesign may substantially improve ticket presentation.

Recommended direction:

- ticket-first / QR-first presentation,
- clear match identity,
- clear ticket status,
- clear seat/zone information,
- clear lifecycle states,
- accessible brightness/display behavior where applicable.

---

## 11. Localization and RTL

Arabic is a first-class UI target.

Any redesigned screen must be evaluated for:

- Arabic content,
- RTL direction,
- text expansion,
- alignment,
- icons whose direction has semantic meaning,
- mixed Arabic/Latin text,
- numerals,
- truncation,
- small devices,
- tablets.

Do not treat RTL as a final cleanup task.

---

## 12. Accessibility

Redesigned interfaces must preserve or improve accessibility.

Check:

- meaningful accessibility labels,
- roles,
- readable contrast,
- focus/interaction behavior,
- touch-target sizes,
- dynamic content feedback,
- loading semantics,
- reduced-motion behavior where applicable,
- screen-reader understanding,
- disabled/busy states.

Visual redesign must not reduce usability.

---

## 13. Responsive Design

The app supports more than one phone size.

Design for:

- small phones,
- normal phones,
- large phones,
- tablets where supported,
- portrait and relevant landscape cases,
- safe areas,
- keyboard interaction.

Avoid layouts dependent on one screenshot size.

---

## 14. Change Discipline

Before implementation:

1. Read `AGENTS.md`.
2. Read `docs/STATUS.md`.
3. Read the relevant architecture/API/security documentation.
4. Inspect the CURRENT implementation.
5. Identify ownership.
6. Identify affected tests.
7. State the intended scope.

During implementation:

- make the smallest coherent change,
- preserve existing domain behavior,
- avoid unrelated cleanup,
- avoid dependency changes unless justified,
- keep components understandable,
- reuse existing primitives when appropriate.

After implementation:

- inspect the diff,
- run relevant tests,
- run TypeScript checks,
- run lint,
- run Expo/config checks when relevant,
- perform focused runtime verification when behavior changed.

Do not declare success from source inspection alone when runtime behavior matters.

---

## 15. Git Rules

Do not commit automatically unless explicitly instructed.

Before a commit:

- show changed files,
- show relevant diff/stat,
- state validation performed,
- disclose anything not verified.

Do not include unrelated changes.

Do not modify local-only agent configuration unless explicitly requested.

---

## 16. Agent Responsibilities

### Claude Code

Claude is the PRIMARY implementation/design-engineering agent for the redesign.

Use Claude for:

- substantial UI redesign,
- architecture-aware implementation,
- component restructuring,
- complex React Native work,
- state-sensitive changes,
- design-system work,
- accessibility work,
- localization/RTL work,
- complex bug fixes,
- broader refactors when genuinely required.

Claude must read:
- `AGENTS.md`
- `CLAUDE.md`
- relevant `/docs/*`

before major work.

### Codex

Codex is primarily the INDEPENDENT verification and targeted-inspection agent.

Use Codex for:

- repository inspection,
- validating Claude's implementation,
- focused bug investigation,
- diff review,
- targeted mechanical fixes,
- test/typecheck/lint/build/config verification,
- identifying unintended architectural drift.

Codex must not redesign Claude's work merely because it prefers another implementation.

### User

The user is the requirements owner and final authority.

The user decides:

- product requirements,
- design direction,
- accepted UX,
- scope,
- whether implementation proceeds,
- whether fixes are accepted,
- whether code is committed.

---

## 17. Required Handoff Model

For substantial redesign work:

    ChatGPT / User defines scope
                ↓
        Claude inspects
                ↓
        Claude implements
                ↓
        Claude reports
                ↓
      Codex independently verifies
                ↓
      Claude fixes valid findings
                ↓
          final verification
                ↓
             User approves
                ↓
              commit

Avoid endless Claude ↔ Codex loops.

A review finding must be concrete and supported by evidence.

---

## 18. Evidence Requirement

Important claims should be supported by inspectable evidence such as:

- file + line/reference,
- code path,
- diff,
- command output,
- test result,
- runtime observation.

Do not report speculative defects as confirmed facts.

Use labels such as:

- CONFIRMED
- HIGH-CONFIDENCE
- POSSIBLE
- NOT VERIFIED

when uncertainty matters.

---

## 19. Documentation Rule

Documentation is part of the implementation.

Update relevant docs when:

- architecture ownership changes,
- API integration changes,
- security assumptions change,
- a redesign phase completes,
- a major decision becomes durable,
- current project status changes.

Do not allow documentation to describe an architecture that no longer exists.

Primary documentation:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/API_INTEGRATION.md`
- `docs/SECURITY.md`
- `docs/STATUS.md`
- `docs/WORKFLOW.md`

---

## 20. Redesign Definition of Done

A redesigned area is not complete merely because it visually resembles the reference.

It must:

- use real production data,
- preserve correct API behavior,
- preserve authentication,
- preserve navigation,
- preserve business rules,
- support loading/error/empty states,
- support Arabic/RTL,
- behave responsively,
- meet accessibility expectations,
- preserve security-sensitive behavior,
- pass relevant tests/checks,
- survive independent verification.

Production correctness takes precedence over visual similarity.
```

---

