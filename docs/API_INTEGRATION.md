# `docs/API_INTEGRATION.md`

```md
# API Integration — LFA User Mobile App

## Principle

The backend is authoritative.

The redesign must adapt to existing API contracts rather than invent frontend contracts based on desired UI.

---

## API Ownership

Network requests should continue through the established API/service layer.

Before adding a new request, search for:

- an existing service,
- an existing endpoint wrapper,
- an existing type,
- another screen already using the same data.

Do not duplicate requests because the new visual component lives elsewhere.

---

## Authentication

Authenticated requests must use the established authentication mechanism.

Do not:

- manually copy tokens into random components,
- store authentication tokens in presentation state,
- bypass the shared client,
- log sensitive authentication data.

Authentication lifecycle remains independent from redesign presentation.

---

## User Identity

Authoritative user/profile data must come from the actual authenticated user flow.

Do not fabricate missing identity fields for redesigned screens.

Where backend information is unavailable, the UI should represent that state honestly.

---

## Request State

Every redesigned API-backed surface should account for:

- initial loading,
- refreshing,
- success,
- empty response,
- recoverable failure,
- non-recoverable failure where applicable.

Avoid permanently replacing failed requests with fake data.

---

## Mutations

For mutations:

- identify submission authority,
- guard duplicate actions when necessary,
- display pending state,
- prevent accidental repeated requests,
- surface stable user-facing errors,
- preserve backend error details only where safe and appropriate.

Do not infer mutation success from button interaction alone.

---

## Cart / Checkout

Cart and checkout APIs are stateful.

Preserve:

- authoritative cart identity,
- item identity,
- quantity behavior,
- checkout lifecycle,
- order relationships.

Redesign controls may use local draft state where appropriate, but server mutations must remain deliberate and controlled.

---

## Payment

BLUE/payment integration is a protected integration boundary.

Before modifying:

- trace order creation,
- payment URL creation,
- payment launch,
- callback/redirect handling,
- success detection,
- failure/cancel behavior,
- retries,
- cart cleanup.

Do not invent a frontend-only payment state machine without reconciling it with the existing implementation.

---

## Tickets

Ticket data must originate from the actual ticket/order APIs.

The redesign may derive presentation values, but must not manufacture authoritative values such as:

- ticket IDs,
- QR values,
- order IDs,
- seat assignments,
- entry status.

---

## Device Registration / Notifications

Push-device registration is platform-integrated API behavior.

Keep registration tied to the existing application/auth lifecycle.

Current intended behavior:

- notification permission is requested through the established startup flow,
- FCM token registration occurs through the established `/devices` integration,
- authenticated registration must use the authenticated user context where required,
- refreshed device tokens must be reconciled correctly,
- duplicate registration requests should not create duplicate device identity server-side.

Do not redesign this mechanism while redesigning notification UI.

---

## Error Messages

UI text should be safe and stable.

Do not blindly show:
- raw exception strings,
- internal HTTP details,
- secrets,
- backend stack traces.

Logging and user-facing messaging serve different purposes.

---

## Contract Uncertainty

If the frontend appears to require data or behavior not represented in the current API:

DO NOT invent it.

Report:

- desired UX,
- current endpoint,
- missing field/behavior,
- affected screen,
- possible frontend fallback if legitimate,
- backend dependency if required.

Backend changes require separate coordination.
```

---

