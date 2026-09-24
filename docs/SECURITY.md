# Security — LFA User App

Security-relevant behavior of the current production app, from source
inspection. §2 lists **verified behavior** that redesign work must preserve.
§3 lists **concerns and follow-up findings**; they are recorded, not fixed.
Remediation is separate, explicitly scoped work.

This document never contains secret values. Do not copy secrets into docs,
reports, commits, or logs.

Related: `docs/ARCHITECTURE.md`, `docs/API_INTEGRATION.md`.

---

## 1. Trust model

- The app is an untrusted client. Everything in the bundle, including every
  `EXPO_PUBLIC_*` value, is extractable.
- The backend is authoritative for identity, cart, reservation expiry, seat
  locks, orders, payment outcome, tickets, and QR content.
- Payment card data never touches app code: CyberSource Unified Checkout
  tokenizes it; BLUE runs on the provider's page.

---

## 2. Verified security behavior (preserve)

### 2.1 Token storage
- Native: bearer token in `expo-secure-store` (`src/lib/authTokenStorage.native.ts`,
  `src/lib/authTokenStorageCore.ts`). Legacy AsyncStorage tokens are migrated
  into SecureStore and the legacy copy is deleted. A `storage_owner` marker
  (`secure` / `cleared`) is written to both stores so a cleared session stays
  cleared even if a physical delete fails.
- If secure storage throws during read, token storage is marked failed for the
  app lifetime (no silent fallback to insecure storage).
- Web: token in `localStorage` (`src/lib/authTokenStorage.ts`) — see §3.3.

### 2.2 Auth lifecycle and stale-session protection
- Token changes increment an authentication generation (`src/services/api.ts`).
  Results from an older generation are discarded (`isAuthenticationSnapshotCurrent`).
- Restore requires both a token and a valid persisted user; any mismatch clears both.
- 401/403 invalidates only the generation that made the request, then clears
  state, dismisses the stack, and routes home (`AuthContext`).
- Logout clears in-memory state before storage, then calls `/auth/logout` with
  the captured token; failures are ignored locally.
- Password change and account deletion clear the session.
- `clearUserScopedCaches()` runs whenever the identity key changes.
- `CartProvider` is keyed by identity; `withAuthRequired` keys screens by
  `userCacheKey` — no state survives an account switch.
- Auth forms are single-submission (`src/lib/authSubmissionGuard.ts`).

### 2.3 Auth return routes and deep links
- Scheme `lfa-app`. Expo Router maps deep links to routes; customer routes are
  wrapped in `withAuthRequired`.
- Post-login `returnTo` is limited to an allowlist of static routes plus
  `/match/<id>` (`src/lib/authReturnRoute.ts`). No arbitrary redirects.
- Result routes (`/checkout/success|failed`, `/checkout/blue/success|failed`)
  are display-only: params are sanitized (`src/lib/checkoutResultParams.ts`:
  provider allowlist, 120-char cap, reason-code allowlist) and they never clear
  the cart or create state.
- Notification taps only navigate to `/match/[id]` from a `match_id` string/number.
- Ad links: internal allowlist or external **HTTPS** only; traversal, credentials,
  and protocol-relative URLs rejected (`src/lib/adUrls.ts`).

### 2.4 Cart and reservation authority
- The server cart is authoritative; the client persists only session ID and
  expiry, and only while authenticated.
- All mutations are serialized and published only for the current cart session
  ticket. Expired or malformed persisted sessions are discarded.

### 2.5 Checkout transaction safety
- BLUE submission is guarded by `submitInFlightRef`, `blueHandoffStartedRef`,
  and `checkoutSubmissionAuthority`; results for a changed session or unmounted
  screen are ignored.
- A pending BLUE attempt is reused for the same cart session instead of
  resubmitting (limits duplicate orders); it is invalidated when the session changes.
- Holder names are required for every ticket slot before submission.
- Billing phone must be a valid canonical phone.
- Card: the transient token is submitted once (`submittingRef`); the
  CyberSource component posts success at most once per mount (`completedRef`).

### 2.6 Payment completion authority and cart clearing
- The cart is cleared **only** via `clearCartIfSession(ticket)` for the session
  captured at payment start, and only after:
  - card: a 2xx `/checkout/mobile/submit` response, or
  - BLUE: a terminal success URL classified by `decideBlueNavigation`.
- BLUE failure and user "Leave" keep the reservation active; expiry is left to
  `CartContext`.
- Result screens never clear state.

### 2.7 BLUE URL and WebView policy (`src/lib/bluePaymentRedirect.ts`, `BluePaymentScreen.native.tsx`)
- `payment_url` must match the configured provider origin exactly, path
  `/payment/<id>`, no encoded `.`/`/`/`\`, no credentials, no hash.
- Every WebView navigation is classified: terminal URLs are handled once
  (`terminalHandledRef`) and not loaded; credentials in URLs are blocked;
  `tel:`/`mailto:` go to the OS; `file:`, `data:`, `javascript:`, `intent:`,
  `market:`, and unknown schemes are blocked.
- `lfa-app://checkout/...` counts as terminal only inside the BLUE WebView context.
- WebView: `mixedContentMode="never"`, no automatic window opening, no multiple
  windows; render/content-process termination shows an error instead of hanging.
- Production builds fail if the BLUE origin is not the configured HTTPS
  provider origin (`app.config.js`).

### 2.8 CyberSource boundary
- The capture context is injected into the WebView HTML as a JSON-escaped
  string literal with `</script` neutralized.
- Messages from the WebView are JSON-parsed; only `ready`, bounded `height`,
  `success` with a token, and `error` are acted on.
- Web lifecycle (`src/lib/cybersourceWebLifecycle.ts`) ignores callbacks from
  superseded capture contexts.

### 2.9 Tickets, QR, orders, PDF
- QR is rendered only from backend `qr_image` values beginning with
  `data:image/`; the client never generates or encodes QR data.
- Portal ticket and match responses are shape-validated before use.
- PDF bytes are fetched with the live token, written to the app cache
  directory, and handed to the OS share sheet; results are dropped if the
  user changed.

### 2.10 Push and device tokens
- Registration decides anonymous vs authenticated at send time and lets
  `apiRequest` read the live token, so a logout during registration cannot
  send a stale bearer token.
- Device tokens are not persisted by the app.

### 2.11 Errors and logging
- User-facing errors come from backend messages or fixed fallbacks; transport
  errors use fixed copy. No stack traces are shown.
- Production `console.error` calls log error objects for avatar, notification,
  and registration failures; none log tokens or passwords.

### 2.12 Transport
- Production API, storage, CyberSource SDK, and BLUE origins configured in
  `eas.json` are HTTPS.
- Staging BLUE uses HTTP; the iOS ATS exception is added only for staging
  profiles and only for that exact host (`app.config.js`).

---

## 3. Security concerns and follow-up findings (not fixed)

Severity is a first assessment for prioritization, not a verdict.

### 3.1 Client-visible API credential — HIGH (pre-existing, known)
`EXPO_PUBLIC_LFA_API_PASSWORD` is committed in `eas.json` (identical across
staging and production profiles), inlined into every native bundle, and sent as
a `password` header on every native request. It must be treated as public.
Whether it grants meaningful privilege is a backend question. Do not
propagate the pattern, log the value, or move it elsewhere during redesign.
Remediation (rotation, removal, backend gating) is separately scoped.

### 3.2 Web proxy forwards any path with the credential — MEDIUM
`src/app/api/[...path]+api.ts` attaches the API password server-side to any
`/api/*` path and method, and falls back to a hardcoded staging base URL when
the env var is unset. Anyone who can reach the web server can use the
credential against any backend path.

### 3.3 Web token in `localStorage` — MEDIUM (web only)
The web build stores the bearer token and user record in `localStorage`, which
is readable by any script on the origin.

### 3.4 BLUE success is inferred from a client-side redirect — MEDIUM
Cart clearing and the success screen follow a URL classification in the
WebView. The client does not confirm the order or payment status with the
backend afterwards. Server-side finalization is not visible in this repo.
Tickets shown later come from the portal API, so the effect is limited to UI
state and cart clearing.

### 3.5 Card success on any 2xx — LOW/MEDIUM (contract-dependent)
`CardPaymentScreen` treats any 2xx submit response as success and does not
evaluate `status`. This is safe only if the backend returns non-2xx for
declined payments (unverified).

### 3.6 BLUE WebView allows any http(s) navigation — LOW/MEDIUM
After the validated initial URL, `decideBlueNavigation` allows any http/https
navigation inside the WebView (`originWhitelist={["*"]}`, JavaScript enabled).
This may be required by the provider's 3-D Secure or bank redirects. Confirm
before restricting.

### 3.7 CyberSource configuration fallbacks — LOW
`config.cybersourceUnifiedCheckoutUrl` falls back to the CyberSource **test**
SDK URL, and the native WebView `baseUrl` falls back to the staging site, when
env vars are missing. `originWhitelist` includes `http://*`. A misconfigured
production build would therefore degrade silently rather than fail.

### 3.8 Displayable success deep links — LOW
`lfa-app://checkout/success?...` (and the BLUE variants) can be opened
externally and will show a "payment successful" screen with sanitized,
attacker-chosen order/reference text. They do not change state.

### 3.9 Logout does not detach the push device — LOW (backend-dependent)
No device unregister call exists; the backend may keep associating the
device with the previous user.

### 3.10 Persisted user record in non-secure storage — LOW
`lfa_portal_user` (name, email, phone, avatar) is stored in AsyncStorage (native)
or `localStorage` (web). Only the token is in SecureStore.

### 3.11 Dev-only logging and temporary diagnostics — LOW
`authService.changePassword` logs the error body under `__DEV__`.
`src/lib/bluePaymentDiagnostics.ts` is marked TEMPORARY and unused. Neither
should be expanded. Removal is separate scoped cleanup.

### 3.12 Maintenance is sticky — LOW (availability)
One 503 locks the app into the maintenance screen until restart.

### 3.13 Android cleartext for staging BLUE — UNKNOWN
Staging BLUE is HTTP. The Android cleartext policy for non-debug staging builds
(`apk`, `preview`) was not verified; generated native projects are not in the repo.

### 3.14 Committed Firebase client configs — NOTE
`google-services.json` and `GoogleService-Info.plist` are committed. These are
client configs, not secrets, but they identify the Firebase project.
Restrictions for those keys belong in the Firebase console.

---

## 4. Rules for redesign work

- Do not weaken, bypass, or reorder any mechanism in §2.
- Do not add persistence of tokens, card data, QR data, or PII.
- Do not add logging of tokens, passwords, capture contexts, transient tokens,
  payment URLs, QR images, or full user records.
- Do not add WebViews, deep-link handlers, or external-link openers without
  the same allowlisting discipline as §2.3 and §2.7.
- Do not add transport exceptions or relax `mixedContentMode` / ATS.
- Do not spread the §3.1 credential pattern to new code paths.
- Treat changes to any file named in §2 as security-sensitive and call them
  out explicitly in the completion report.
- A security finding discovered during a task is reported, not silently fixed,
  unless the user scopes the fix.
