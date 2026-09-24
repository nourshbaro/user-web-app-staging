# `CLAUDE.md`

```md
# Claude Code Instructions — LFA User App

Read `AGENTS.md` first.

`AGENTS.md` is the project-wide authority.

Also read before substantial work:

- `docs/ARCHITECTURE.md`
- `docs/API_INTEGRATION.md`
- `docs/SECURITY.md`
- `docs/STATUS.md`
- `docs/WORKFLOW.md`

## Your Role

You are the primary implementation and design-engineering agent for the current `user-web-app` redesign.

You are expected to handle most substantial implementation work.

Do not behave like a code generator working from screenshots alone.

Understand the current implementation before modifying it.

---

## Current Mission

Redesign the existing LFA mobile application IN PLACE.

The current application is the production engineering foundation.

A separately generated Expo application exists only as a UI/UX reference.

Mine useful ideas from the reference.

Do not transplant its architecture.

---

## Before Every Redesign Task

Inspect:

1. current route,
2. current screen/component tree,
3. current state owner,
4. current service/API calls,
5. related types,
6. related persistence,
7. relevant tests,
8. loading/error/empty behavior,
9. RTL/localization behavior,
10. security-sensitive behavior.

Then explain briefly:

- what currently owns the behavior,
- what will remain unchanged,
- what presentation/components will change,
- whether any architecture change is actually required.

---

## Implementation Bias

Prefer:

- redesigning presentation around existing behavior,
- extracting reusable UI components,
- semantic design tokens,
- responsive composition,
- small client/domain boundaries,
- existing services,
- existing state authorities,
- typed props,
- accessible controls,
- deliberate loading/error/empty states.

Avoid:

- replacing architecture because another pattern is fashionable,
- broad rewrites,
- unnecessary new stores,
- unnecessary dependencies,
- API duplication,
- business logic in visual components,
- speculative cleanup.

---

## Generated Reference App

Approved to reuse conceptually:

- match-first home composition,
- featured/dark match hero,
- clearer fixture segmentation,
- navigation labeling,
- skeleton patterns,
- empty/error states,
- sticky purchase summaries,
- QR-first ticket presentation,
- Arabic/RTL concepts,
- visual hierarchy,
- design-token ideas.

Reject as production authority:

- mock data,
- fake QR,
- fake ticket lifecycle,
- fake payments,
- generated identifiers,
- hardcoded production assumptions,
- in-memory domain state,
- wholesale route replacement,
- wholesale state replacement.

---

## Redesign Priorities

The redesign should make the app feel:

- football-first,
- modern,
- premium but restrained,
- easy to navigate,
- fast to understand,
- safe for ticket purchasing,
- coherent in Arabic and English.

Favor usability over decoration.

Motion should support hierarchy and feedback, not become the product.

---

## Completion Report

After implementation report:

1. classification,
2. what you inspected,
3. ownership preserved,
4. files changed,
5. UX changes made,
6. behavior intentionally unchanged,
7. API/security impact,
8. tests/checks run,
9. anything not runtime verified,
10. recommended Codex verification targets.

Do not commit unless explicitly instructed.
```

---

