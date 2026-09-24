# `docs/ARCHITECTURE.md`

```md
# Architecture — LFA User Mobile App

## Purpose

This document defines the architectural boundaries that must survive the ongoing UI/UX redesign.

The redesign is not a rewrite.

---

## Application Shape

The app is an Expo / React Native / TypeScript application using Expo Router.

The repository contains the authoritative implementation for the mobile user experience.

Typical responsibilities are separated across:

- route/screens,
- reusable components,
- context/state owners,
- services/API clients,
- domain helpers,
- localization,
- platform integrations,
- tests.

Always inspect the repository before relying on this document for exact filenames.

---

## Architecture Principle

Presentation may change aggressively.

Business ownership should change conservatively.

A screen should render state owned by the appropriate domain layer rather than recreate that state itself.

---

## Ownership Model

### Routes

Routes own navigation-level composition.

Routes should not become duplicated API/service layers.

### Components

Components primarily own presentation and local ephemeral interaction state.

Examples:

- selected tab,
- accordion state,
- local input draft,
- presentation toggles,
- modal visibility.

They should not independently become authoritative owners of:

- authenticated identity,
- cart contents,
- completed orders,
- payment status,
- backend tickets.

### Context / Domain State

Existing shared state owners remain authoritative unless a deliberate architecture task changes them.

Do not introduce another global store just for redesigned components.

### Services

Network communication belongs in existing service/API layers.

Keep:
- authentication handling,
- base URL handling,
- headers,
- response normalization,
- shared error behavior

centralized.

---

## Redesign Architecture

Preferred flow:

Backend / native integration
        ↓
Service layer
        ↓
Existing domain/state authority
        ↓
Route composition
        ↓
Redesigned presentation components

Not:

Backend
   ↓
New redesigned component
   ↓
ad-hoc request
   ↓
duplicate state

---

## Design System Direction

The redesign should converge on shared semantic primitives.

Prefer semantic concepts such as:

- background,
- surface,
- elevated surface,
- text primary,
- text secondary,
- border,
- accent,
- success,
- warning,
- destructive,
- live,
- disabled.

Avoid scattering arbitrary values across screens.

Reusable primitives should emerge where repeated patterns are confirmed.

Do not prematurely create a huge design system.

---

## Match Experience Direction

The consumer experience should become more match-first.

Potential composition:

- featured/current match,
- live state,
- upcoming fixtures,
- competition context,
- match details,
- ticket availability,
- purchase action.

The exact structure must follow real backend data and existing application capabilities.

---

## Ticket Experience Direction

Ticket presentation should prioritize what a supporter needs at entry:

1. ticket validity/status,
2. match identity,
3. QR/code,
4. seat/zone information,
5. useful lifecycle/status details.

Visual redesign must remain backed by authoritative ticket data.

---

## Checkout Architecture

Checkout is transactional.

UI redesign must remain downstream of the existing checkout/order/payment authorities.

Do not create UI-local representations that become authoritative over server state.

A pending transaction and a completed transaction are different states.

Keep those distinctions explicit.

---

## Navigation

Do not replace navigation structure wholesale because the design reference uses another structure.

Changes to top-level navigation require:

- route inventory,
- deep-link impact review,
- auth gating review,
- notification-navigation review,
- ticket/payment navigation review.

Labels and presentation may change more freely than route semantics.

---

## RTL

RTL must be supported structurally.

Avoid components whose layout only works when `flexDirection`, alignment, or directional icons assume LTR.

Test components conceptually and at runtime in both language directions.

---

## Responsive Architecture

Components should adapt rather than branch into unrelated phone/tablet implementations where avoidable.

Use:
- flexible widths,
- safe areas,
- sensible max widths,
- content-driven height,
- adaptive spacing.

Avoid screenshot-specific dimensions.

---

## Animation

Animation is permitted when it improves:

- transition understanding,
- feedback,
- hierarchy,
- state change comprehension.

Avoid:
- long blocking transitions,
- excessive parallax,
- constant decorative movement,
- animation required to discover information.

Respect reduced-motion expectations where relevant.

---

## Generated Prototype Relationship

The generated prototype is not an upstream codebase.

Its role is analogous to:

- UX reference,
- concept exploration,
- visual research.

No architectural dependency exists between it and this repository.

---

## Architectural Change Policy

If redesign genuinely requires an architecture change:

1. identify the limitation,
2. demonstrate why presentation-only changes are insufficient,
3. document existing ownership,
4. propose the smallest architectural change,
5. assess API/security/payment impact,
6. receive approval before broad implementation.

Architecture should not drift accidentally during a UI task.
```

---

