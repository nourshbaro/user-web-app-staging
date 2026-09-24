# `docs/SECURITY.md`

```md
# Security — LFA User Mobile App

## Principle

Security boundaries must survive redesign work unchanged unless the task explicitly concerns security.

Visual redesign is not authorization to weaken an integration.

---

## Client Trust

The mobile application is an untrusted client from the backend's perspective.

Never place privileged secrets in the bundle.

Anything exposed through public Expo configuration must be assumed extractable.

Client-side hiding is not secret storage.

---

## Public Credential Concern

Any existing client-visible API credential architecture must be treated as a separate security concern.

Do not casually refactor or propagate such credentials during redesign work.

If encountered:

1. document where it originates,
2. document where it is used,
3. determine whether it grants meaningful privilege,
4. avoid spreading the pattern,
5. keep remediation separate unless explicitly scoped.

---

## Authentication

Preserve:

- token ownership,
- logout cleanup,
- authenticated request behavior,
- protected route behavior,
- identity restoration.

Do not expose tokens in logs or UI.

---

## Payments

Payment success must be authoritative.

Do not:

- mark payment successful because a WebView navigated somewhere unexpected,
- rely exclusively on user-controlled query data when stronger verification exists,
- clear valuable state prematurely,
- create duplicate paid/pending orders through retry races.

Use the established integration and verify changes carefully.

---

## Native Platform Security

Never bypass platform security broadly to make a broken integration work.

Example principles:

- HTTPS is preferred for payment/network endpoints.
- Do not add broad insecure transport exceptions as a convenient workaround.
- Do not disable platform protections globally without explicit security review.

Infrastructure defects should not be hidden by unsafe client configuration.

---

## QR / Tickets

QR values are security-sensitive transactional data.

Never create fake functional QR data.

Avoid exposing ticket secrets outside the surfaces that legitimately require them.

---

## Logging

Logs must not leak:

- tokens,
- passwords,
- privileged credentials,
- complete payment-sensitive data,
- unnecessary personal information.

Temporary debugging logs must be reviewed before completion.

---

## User Data

Collect and retain only the data required by current product behavior.

Do not introduce persistence merely to make redesigned screens easier.

---

## Dependencies

A redesign should not add dependencies without a concrete need.

Before adding a dependency consider:

- maintenance,
- native impact,
- Expo compatibility,
- bundle impact,
- permissions,
- security posture,
- whether existing code already solves the problem.

---

## Permissions

Mobile permission handling must:

- request only required capabilities,
- explain denied states clearly where appropriate,
- handle permanent denial safely,
- avoid repeated harassment,
- provide Settings recovery where needed.

UI redesign must preserve working permission behavior.

---

## Security Review Trigger

Focused security review is required for changes involving:

- authentication,
- payment,
- ticket QR,
- deep links related to transactions,
- device registration,
- permissions,
- credentials,
- persisted sensitive data,
- network configuration.
```

---

