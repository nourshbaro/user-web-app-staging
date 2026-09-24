# `docs/WORKFLOW.md`

```md
# Development Workflow — LFA User Mobile App

## Objective

Move quickly without sacrificing production behavior.

The redesign should not repeat the slow pattern of splitting trivial work into excessive microtasks.

Work in coherent screen/feature batches.

---

## Default Redesign Workflow

### 1. Scope

User + ChatGPT define a coherent redesign target.

Examples:

- Home + Match Card system
- Match Details
- Ticket Selection
- Cart
- Checkout
- My Tickets
- Ticket Detail
- Profile

Avoid creating separate tasks for every tiny visual detail unless risk requires it.

---

### 2. Claude Inspection

Claude reads project instructions and inspects the complete relevant feature.

Claude identifies:

- route ownership,
- components,
- state,
- API calls,
- navigation,
- persistence,
- tests,
- security-sensitive behavior.

Claude should not edit until it understands the active implementation.

---

### 3. Claude Implementation

Claude performs the coherent redesign batch.

Claude may:

- restructure presentation components,
- create reusable UI primitives,
- update styles,
- improve accessibility,
- add proper UI states,
- improve RTL/responsiveness.

Claude should avoid unrelated architecture changes.

---

### 4. Claude Verification

Before handoff Claude runs relevant checks.

Expected where applicable:

- TypeScript,
- lint,
- tests,
- Expo config validation,
- platform-specific checks,
- focused runtime scenarios.

Claude reports exact results.

---

### 5. Codex Independent Review

Codex receives the implementation AFTER Claude completes it.

Codex should review with fresh context.

Codex checks:

- unintended behavior changes,
- duplicated state,
- broken API ownership,
- payment/cart regressions,
- route problems,
- missing error states,
- accessibility problems,
- RTL/responsive problems,
- stale/dead implementation,
- test coverage,
- suspicious security changes.

Codex should NOT:

- rewrite the screen based on personal preference,
- create unnecessary refactors,
- replace valid architecture,
- expand scope.

Findings must be concrete.

---

### 6. Finding Classification

Codex findings should be classified:

- BLOCKER
- HIGH
- MEDIUM
- LOW
- NOTE

Only confirmed or strongly evidenced issues should block progression.

Do not create review loops over subjective stylistic preference.

---

### 7. Claude Correction

Valid findings return to Claude.

Claude:

- verifies the finding,
- applies the narrowest correct fix,
- reruns affected verification,
- reports the correction.

Do not restart the entire redesign.

---

### 8. Final Verification

Codex or targeted checks verify the corrected result.

Expected final state:

`PASS`

or:

`PASS WITH NOTES`

A NOTE must not secretly contain a blocking defect.

---

### 9. Runtime Review

The user reviews the actual app.

Source-level correctness does not prove UI quality.

Runtime review should consider:

- appearance,
- interaction,
- phone sizing,
- tablet sizing if relevant,
- keyboard,
- loading,
- errors,
- RTL,
- real backend data,
- transaction flow.

---

### 10. Commit

Commit only after approval.

Keep commits coherent.

Examples:

- `feat(app): redesign home and match discovery`
- `feat(app): redesign match details experience`
- `feat(app): redesign ticket purchase flow`
- `feat(app): redesign user tickets`
- `fix(app): address checkout redesign regressions`

Avoid mixing unrelated work into one commit.

---

# Responsibility Matrix

## User

Owns:
- requirements,
- design preference,
- feature intent,
- acceptance,
- commit approval.

## ChatGPT

Owns:
- coordination,
- translating requirements into implementation scope,
- maintaining project continuity,
- deciding which agent should handle a task,
- reconciling Claude/Codex findings,
- maintaining documentation direction.

## Claude

Owns most:
- implementation,
- design engineering,
- architecture-aware frontend work,
- complex changes,
- significant refactors,
- fixes resulting from valid review findings.

## Codex

Owns primarily:
- inspection,
- independent verification,
- repository checks,
- diffs,
- mechanical fixes when explicitly assigned,
- tests/typecheck/lint/config validation.

Claude should be used substantially more than Codex during the redesign.

---

# No Endless Agent Loop

Default:

Claude implementation
→ Codex review
→ Claude correction
→ final verification

Stop.

Do not repeatedly bounce implementation between agents unless a real unresolved defect remains.

---

# Design Reference Workflow

When using the generated reference application:

1. identify the UX idea,
2. determine why it is useful,
3. inspect how the production app currently handles the feature,
4. adapt the idea to production architecture,
5. do NOT copy architecture blindly,
6. verify with real APIs/state.

Examples:

Good:
> The prototype has a clearer upcoming/live match hierarchy. Reproduce that hierarchy using the existing match services and routes.

Bad:
> Copy the prototype home route, mock store and generated data into production.

---

# Scope Rule

Prefer one coherent batch over many artificial subtasks.

Good:

`Redesign Match Details`

with:
- hero,
- information hierarchy,
- states,
- responsive behavior,
- ticket CTA.

Not automatically:

- MD-01
- MD-01A
- MD-01B
- MD-01C
- MD-02A
- MD-02B

Split only when:

- security risk differs,
- transaction behavior differs,
- implementation ownership differs,
- a change is too large to verify safely.

---

# Evidence Standard

Reports should contain evidence.

Good:

> `AuthContext.tsx` remains the sole owner of authenticated user restoration. No new auth state was introduced.

Better when needed:

> TypeScript: PASS  
> Tests: 284/284 PASS  
> Expo config: PASS

Avoid:

> Everything looks good.

---

# Documentation Update Rule

At the end of each major redesign batch:

Update `docs/STATUS.md`.

Update other docs only when their durable information changed.

Do not rewrite all docs after every cosmetic task.
```
