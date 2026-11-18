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
- Account deletion takes two explicit steps: a non-dismissible destructive
  confirmation in Settings, then `/delete-account`, the only place the
  request is sent (current password required by the backend; disabled
  without it; single-flight; the screen cannot be left mid-request).
- `clearUserScopedCaches()` runs whenever the identity key changes.
- `CartProvider` is keyed by identity; `withAuthRequired` keys screens by
  `userCacheKey` — no state survives an account switch.
- Auth forms are single-submission (`src/lib/authSubmissionGuard.ts`); the
  password-recovery "Resend code" shares the same synchronous guard as the
  recovery submit, so a resend and a verify can never be in flight together.
- A persisted or `/auth/me` user with `email: null` (a phone-only account) is
  valid; any other non-string email is still rejected.

### 2.2a Password recovery (frontend guarantees)
- One owner (`src/lib/passwordRecovery.ts`); passwords and codes live only in
  screen memory (no storage, no logging, no route params).
- The client never infers whether an account or email exists: it branches
  only on the backend's `reason: "email_required"`, never on message text.
  The generic forgot-password answer for known and unknown emails is
  preserved as-is (it deliberately hides account existence).
- Each request belongs to one attempt; changing the identifier or method,
  Back, cancel and completion start a new one, and late answers (success or
  error) for an earlier attempt are dropped.
- `add-email` is sent only for the phone the backend answered
  `email_required` for in the current attempt, and the flow moves to the
  code only after a 2xx. **This sequencing is UX, not a security boundary**
  (§3.18).
- A phone recovery attempt that receives the generic successful
  forgot-password response advances to the code step bound to that
  attempt's phone. Verify, Reset and Resend use only the recovery identity
  bound to that attempt (`recoveryTarget`); they never use a live form field
  or infer the account's email.
- Recovery never signs the user in; it returns to Sign in.

### 2.3 Auth return routes and deep links
- Scheme `lfa-app`. Expo Router maps deep links to routes; customer routes are
  wrapped in `withAuthRequired`.
- Post-login `returnTo` is limited to an allowlist of static routes plus
  `/match/<id>` (`src/lib/authReturnRoute.ts`). No arbitrary redirects.
  `/notifications` is allowlisted; `/change-password` and `/delete-account`
  are deliberately not (a sign-in never lands in an account-security step).
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
- A resolved mutation is not success: success requires a confirmed
  publication for the current session. After an unknown outcome the shared,
  session-scoped cart re-read gate (`CartContext` + `cartReconciliation.ts`)
  blocks further mutations and every payment action until a confirmed
  re-read; mutations are never replayed blindly.

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
- **One payment attempt per cart session, across methods and surfaces**
  (`src/lib/paymentOutcomeLock.ts`, `docs/ARCHITECTURE.md` §10):
  - a submission must first acquire the session's attempt (a synchronous
    claim; any other Card, BLUE or free attempt for that session is refused) and
    persist it (`lfa_payment_outcome_lock`: session id and method only — no
    payment data) **before** anything is sent; if it cannot be persisted,
    nothing is sent;
  - immediately before `/checkout/mobile/submit` the owner re-checks the
    cart owner's current state: session, **reservation expiry** (from
    `expires_at`, not the last render or tick), cart re-read gate,
    unknown-outcome lock, and competing attempt. Only the acquiring attempt
    passes; a blocked attempt sends nothing and is settled. Exception: a
    card result the CyberSource form already returned is not stopped by
    the client expiry alone (`cardResultSubmitBlocker`; it may already be
    charged, and the backend decides on the reservation), and a blocked
    card result is kept unresolved, never settled (§2.8);
  - the Pay handler re-validates the same state before either handoff.
- **Unknown outcomes require explicit consent before another payment**:
  - a transport failure, timeout or 5xx (except 503) on submit, a BLUE
    success whose cart clear did not happen, or a completed card submit that the closed
    card screen could not reconcile locks the session for every method;
  - after a restart, a persisted unfinished attempt for the restored session
    becomes that lock; an unreadable record or storage read failure locks the
    restored session (fail closed);
  - only a definite non-completion (4xx, 401/403, 503, BLUE failure redirect,
    or a submit blocked before sending) releases the attempt;
  - Checkout's "Pay again" confirmation may enable a separate attempt for
    the same reservation after a confirmed cart re-read (§2.8). It does not
    settle the earlier attempt as uncharged or resolve its result. Active
    attempts/open card forms remain protected; no automatic replay occurs;
  - a session lock or attempt never applies to a different cart session;
    unresolved card markers can still pause card payments across sessions.

### 2.6 Payment completion authority and cart clearing
- The cart is cleared **only** via `clearCartIfSession(ticket)` for the session
  captured at payment start, and only after:
  - card: a submit response that the single completion decision
    (`cardSubmitCompletion`) calls complete: a 2xx without
    `payment.payment_url`, the rule `user-web` uses (§2.8, §3.5), or
  - BLUE: a terminal success URL classified by `decideBlueNavigation`, or
  - free (zero-total) order: a submit response that `freeSubmitCompletion`
    calls complete (same rule as card: an order id or number, `status:
    "paid"`, no `payment_url`), for the still-current cart session and
    Checkout submission. The response shape was stated by the product owner,
    not verified (`docs/API_INTEGRATION.md` §9a, §14).
- Free checkout is chosen only from a validated backend zero
  (`parseCartTotal` / `isFreeCartTotal`): a missing, `null`, empty or
  malformed total is `NaN`, never 0, so it can never turn a paid cart into
  `payment_method: "free"`. An account-scope card pause does not block a free
  order (no card is involved); a session lock does.
- BLUE failure and user "Leave" keep the reservation active; expiry is left to
  `CartContext`. "Leave" keeps the BLUE attempt held (§2.5), so Card cannot
  start for that session meanwhile.
- A provider success that could not be matched to a cleared cart for the same
  session is never shown as success; it locks the session and points to
  My Tickets.
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

#### Unresolved card results (autoProcessing)
With `autoProcessing: true`, CyberSource's form may authorize the payment
before `mount()` resolves, so its result can exist without an LFA order.
- **Recording.** `CardPaymentScreen` records every result before any check
  (`recordUnresolvedCardResult` in `src/lib/paymentOutcomeLock.ts`).
- **What is persisted.** Only a marker: the account and cart session from
  the handoff that opened the form, the time, a support reference when one
  was readable, and a key. The payment JWT, billing details and holder names
  are never persisted. The key is a 64-bit fingerprint of the result
  (`cardResultKey`), so it is unique per payment result across tabs and
  processes, and the same for a repeated callback.
- **Resolved stays resolved.** A marker resolved in this process is never
  shown as unresolved again here, whatever a later read, stale load or
  account switch returns (`resolvedKeys`). A resolution that lands while the
  marker's write is still pending queues its removal behind that write
  (`writesInFlight`), so a write that reaches storage late cannot revive the
  marker after a relaunch. A write still queued when the marker is resolved
  skips itself. Remaining window: the app dying between the late write and
  the queued removal; the marker then blocks again after relaunch (fails
  closed).
- **Superseded chunks.** Rewriting a record leaves its old chunk generation
  to delete; a version-1 generation can hold the JWT and personal details.
  A failed deletion is recorded (`<slot>.gc`, or in memory if even that
  write fails) and retried on every account selection and on relaunch.
- **Older records.** Records written by the first version, which held the
  JWT and checkout context, are still read and still block. They are
  rewritten as markers once read (they stay as they are, and keep blocking,
  until a rewrite succeeds).
- **Storage** (`src/lib/unresolvedCardResultStorage*.ts`). Native uses
  SecureStore, chunked below the historical ~2048-byte iOS value ceiling, plus
  an AsyncStorage ledger. Web uses `localStorage` only, never the app's
  memory-fallback `storage` adapter. The ledger takes markers whose primary
  write failed and "resolved" tombstones for removals the primary could not
  apply:
  - a marker counts as saved only when a durable store accepted it;
  - a removal counts only when the primary applied it or the ledger
    recorded it;
  - anything else is reported: "not saved" on screen, `notSaved` from the
    resolve call.
  Unsaved writes and removals are retried when the account is selected
  again (for example on Checkout focus).
- **Relaunch.**
  - A saved marker blocks again after a relaunch.
  - A tombstoned removal stays resolved after a relaunch.
  - Known gaps:
    - a marker no store accepted is gone after a relaunch (the user was
      told it was not saved);
    - a removal no store accepted makes the result block again after a
      relaunch, until a retry succeeds (this fails closed).
- **Default blocking** (`readPaymentOutcomeLock`). Unless acknowledged by the
  explicit new-payment consent below, an unresolved marker:
  - blocks **every method** (card and BLUE) on its own checkout session:
    that checkout may already be paid;
  - blocks new **card** payments for that account on every other session
    (`scope: "account"`), after a restart and after signing out and back
    in;
  - never blocks BLUE on an unrelated checkout session (a separate backend
    checkout).
  Markers never expire; neither consent nor notice deletion resolves or
  removes them. Another account's markers are not loaded or shown.
- **User-authorized new payment** (product decision, 2026-11-18).
  Checkout's session/account warning offers "Pay again", including for the
  same reservation. `prepareNewPaymentAfterUnknown` captures the observed
  lock, parked attempt, marker keys, account/generation and checkout authority
  before the confirmation dialog. The dialog warns that the earlier payment
  may have succeeded and another charge is possible. Acceptance must be
  followed by a confirmed, non-empty cart publication for that same session.
  The one-use consent refuses stale authority, new markers/replacement locks,
  active attempts or any open card form. Account-marker storage must be ready;
  unreadable storage still offers a retried read, not this override.
  Consent clears only the observed in-memory session lock/parked attempt and
  acknowledges the existing keys for this account + session in memory. The
  old markers and durable session record stay intact; a restart or account
  change requires consent again, and a new result blocks again. Checkout
  clears the pending BLUE URL and resets capture context. No payment is sent
  by the confirmation: a new attempt still acquires/persists the shared gate
  and passes the normal final guards. A submitted token is never replayed.
- **Delete notice** on My Tickets is a separate presentation action. After
  confirmation it saves `lfa_card_notice_hidden:<accountId>:<markerKey>`
  through the existing `storage` adapter. It hides that account's notice on
  this device only, without deleting/resolving its marker, clearing the cart,
  or granting retry consent. A never-sent held result keeps "Send order"
  instead of deletion. Preference read failures keep the warning visible;
  write failures show an error. This visibility preference has the ordinary
  web adapter's memory fallback and is not a durable payment authority.
- **Unreadable marker storage.** While the markers are being read, every
  method is blocked briefly. If they cannot be read, card stays paused for
  the account, and a checkout session **restored from an earlier launch** is
  blocked for every method with `reason: "unreadable"` (a marker for it
  cannot be ruled out). Checkout explains this and offers a retried read
  (`selectPaymentAccount`); a successful read replaces the uncertainty with
  what is actually stored. A session first seen in this process cannot have
  a marker the process does not already hold in memory, so BLUE stays
  available on a new checkout. Known gap: on web, a second tab sharing the
  same cart session is not covered by this reasoning.
- **Binding.** A card attempt is bound to the handoff's cart session and to
  the authentication snapshot captured, for the handoff's account, before
  the form opens (`CardAttemptBinding`). It is live only while that session
  is the **mounted** cart owner's (`registerCartOwner`; a retired provider is
  never consulted) and the snapshot is still current. The card attempt
  acquisition, every card session-lock write
  (`markPaymentOutcomeUnknownIfLive`, including from an inactive screen) and
  the final pre-submit guard all require a live binding. A late callback, a
  retired provider or an earlier sign-in therefore never acquires, submits,
  or replaces a newer session's lock, attempt or persisted record.
- **401/403 attribution.** The submit is pinned to that snapshot
  (`apiRequest` `authenticationSnapshot`, `requestAuthentication`). Its
  token is sent, a 401/403 can end only that authentication, and nothing is
  sent once it is no longer current (`StaleAuthenticationError`). A bare
  override token without a snapshot invalidates nothing on a 401/403.
- **Completion (one decision).** `cardSubmitCompletion` alone decides the
  success screen, clearing the matching cart (`clearCartIfSession`) and
  marker release. The backend success contract is **not confirmed**, so the
  rule is a conservative frontend narrowing (§3.5). A 2xx completes only
  when the body is a JSON object, `success` is absent or exactly `true`,
  `payment` (if present) is an object without a truthy `payment_url`, a
  valid `order_id` or `order_number` is named, the order `status` is
  `paid`, and `payment.status` (if present) is one of paid / authorized /
  captured / completed / succeeded / success / settled / approved. Anything
  else, including an empty or non-JSON body (null from `apiRequest`; this
  app's web proxy passes bodies through unchanged), `{}`, `success: false`,
  or a declined or pending status, is **unresolved, not failed**: no success
  screen, the cart is kept, the session is locked through the live binding,
  and the marker blocks by default until explicit new-payment consent. An
  order the response named is shown as the
  support reference. Every non-2xx is unresolved (below).
- **Failures.** Every other ending (not submitted, 4xx, 5xx, 401/403, 503,
  timeout, network) keeps the marker: no backend contract makes any of them
  final. The copy says the card may have been charged; it never says
  "nothing was charged" or "payment received".
- **Claims.** Decoded claims (status, id) are unverified. Only the `id` is
  shown, as a support reference; no status decides anything.
- **No replay.** A result that reached the submit call is never sent again
  (no automatic or manual resubmission): backend idempotency is not
  established. The only result sent later is one that was **never sent**:
  held back before the submit by the cart's "re-read first" gate. It is kept
  in memory only (never persisted), the cart is re-read at once, and it is
  sent once when the read confirms the same session (otherwise from "Send
  order" on the card screen, Checkout or My Tickets). A backend answer that
  ends the session leaves it unresolved (marker kept).
- **Reservation expiry.** The client timer never tears down a card payment
  in progress. `CartContext.expireCart` defers (the countdown calls it
  again each second) while the form is open, a result is being handled
  (`markCardFormOpen`, taken synchronously when a result arrives), or a
  never-sent result is held (`hasHeldCardResult`). After the timer ends,
  the open form is locked (an overlay, focus removed so the keyboard closes,
  a page shield in the WebView, hidden from screen readers) but stays
  mounted for `CARD_FORM_EXPIRY_GRACE_MS` (90 s) of foreground time, so a
  result CyberSource is already processing still arrives and is submitted.
  The backend decides whether the reservation is still valid. Without a
  result the form closes and expiry runs; its notice says a payment may have
  been taken.
- **Form lifecycle.** Leaving an open card form asks first (it destroys any
  payment in progress in it). An error after the form was shown (the
  provider rejected `mount()`) or the WebView process dying
  (`onRenderProcessGone` / `onContentProcessDidTerminate`) is shown as an
  unknown outcome ("check My Tickets before paying again"), never as a
  cancellation, and the form is not reloaded in place. An error before the
  form was shown (SDK load failure) keeps the in-form retry.
- **Not covered by the client:** if the app is killed, the form is left, the
  grace period ends, or the WebView dies before CyberSource hands the result
  to the app, nothing is recorded. Only backend reconciliation with
  CyberSource can recover that payment.

#### Vendor SDK limitation: `createTrigger("PANENTRY")` (verified 2026-10-05)
This is a CyberSource Unified Checkout SDK defect, not an LFA backend or
frontend requirement.

- Card entry uses `client.createCheckout({ autoProcessing: true })` +
  `checkout.mount({ paymentSelection, paymentScreen })` on native and web.
  CyberSource renders its own "Checkout with card" selection button inside its
  iframe; the card form opens after the user taps it.
- Removing that step with the documented v1
  `client.createTrigger("PANENTRY", { autoProcessing: true })` +
  `trigger.mount("#uc-payment-form")` was investigated. On Android staging it
  failed before rendering card entry
  (`TypeError: Cannot read properties of undefined (reading 'telegram')`).
- Cause: every v1 SDK build tested (`uc/v1/assets/1.0.0` through `1.3.0`;
  production 1.0.0 is identical to test) runs `addSrcSubscriptions()` during
  trigger setup, which reads `this.SRC.telegram` without a guard. `SRC` (the
  Click to Pay component) only exists when the capture context allows
  `CLICKTOPAY`. LFA's capture context is card-only (`PANENTRY`), so the
  trigger always throws.
- LFA intentionally does not enable `CLICKTOPAY` to work around this: "Other"
  is card-only.
- Do not replace `createCheckout()` with `createTrigger("PANENTRY")` until
  CyberSource ships a version that supports PANENTRY with the production
  card-only capture context and that version is runtime verified.
- Do not programmatically click the CyberSource button. It is inside
  CyberSource's cross-origin iframe, and scripted clicks on vendor payment UI
  are out of bounds.
- The experimental implementation was not shipped; production behavior is
  unchanged.

### 2.9 Tickets, QR, orders, PDF
- QR is rendered only from backend `qr_image` values that are bounded raster
  base64 data URIs (`data:image/png|jpeg|webp;base64,…`, ≤ 512,000 chars;
  `ticketQrSource`). SVG, URLs, storage paths and other schemes are rejected;
  the client never generates or encodes QR data, and never derives it from
  `ticket_code`.
- Reservation expiry keeps only a display snapshot (unique match ids and
  whether a payment touched the session) to present v3 "Reservation expired";
  no seats, lock keys, session, checkout or payment data survive the clear,
  and "Start again" never re-reserves. "No payment was taken" is shown only
  when no attempt, pending BLUE request or unknown outcome existed.
- Switching payment method: a BLUE request whose page was left is parked
  (`parkPaymentAttempt`), so Other may start its own card attempt and BLUE
  resumes its stored URL without resubmitting. In-progress attempts always
  block competing payments. Unknown outcomes block every method until explicit
  Checkout retry consent;
  a restart with an unsettled record still fails closed and requires consent
  again. A BLUE order left open may be approved later in
  the BLUE app even after a card success (backend reconciliation, not
  visible to the app).
- Login / Register never impose a client-side OTP; the backend decides by
  withholding the session (`credentialOutcome`). A backend-required code is
  still collected; password recovery keeps its OTP steps (§2.2a).
- The BLUE handoff record carries an optional display-only
  `purchasedMatchId` (success → "View my ticket"); it never takes part in URL
  validation, terminal handling, payment locks or cart clearing.
- Avatar upload / removal results are published into `AuthContext` only while
  the authentication generation that started them is current
  (`runOwnedAvatarMutation`), so one account's result never reaches another.
- Portal ticket and match responses are shape-validated before use.
- PDF bytes are fetched with the live token, written to the app cache
  directory, and handed to the OS share sheet; results are dropped if the
  user changed.

### 2.10 Push and device tokens
- Registration decides anonymous vs authenticated at send time and lets
  `apiRequest` read the live token, so a logout during registration cannot
  send a stale bearer token.
- Device tokens are not persisted by the app.
- A received or opened push only invalidates the notification inbox and
  unread count; the payload is never trusted for state. The inbox and count
  are private reads in the identity-scoped portal cache (memory only, dropped
  on any identity change, late responses for a previous identity discarded)
  and the API is read-only (nothing is marked read in the app).
- The app-version check (`/app-versions/check`) is public: it sends no
  session token, a 401 never touches the session, and it fails open. Its
  store link is opened only after the official-listing allowlist
  (`validStoreUrl`) accepts it, re-checked at the moment of opening.
- Expo Go is not an authoritative push environment: there,
  `src/lib/notifications.ts` never loads `expo-notifications` or reaches
  Firebase, and push degrades to "unavailable". Development and release builds
  keep the full integration; push behavior is verified only in those builds
  (`docs/ARCHITECTURE.md` §12).

### 2.11 Errors and logging
- User-facing errors show the backend's own message (or the payment
  provider's reason) whenever one exists, on every API-backed surface; fixed
  copy is only the fallback, and transport errors use fixed copy. A payment
  with an unknown outcome keeps its "may have gone through" guidance after the
  reason. Raw client exception text and stack traces are never shown.
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
staging and production profiles) and sent as a `password` header on every
native request. Because `src/lib/config.ts` reads it at module scope, Metro
inlines it into **both native client bundles (Android, iOS) and the web client
bundle**, even though web requests do not send it (verified by bundle
inspection in Phase 0). The web `/api` server function does not inline it; it
reads the credential from the server environment at runtime. It must be
treated as public. Whether it grants meaningful privilege is a backend
question. Do not propagate the pattern, log the value, or move it elsewhere
during redesign. Remediation (rotation, removal, backend gating) needs
backend/infrastructure/security coordination and is not performed in redesign work.

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

### 3.5 Card completion is a conservative narrowing, not a verified backend contract — MEDIUM (backend-dependent)
One decision (`cardSubmitCompletion`, §2.8) drives the success screen, cart
clearing and marker release. The backend handlers are not in this workspace
and `user-web` accepts any 2xx, which is not evidence of the contract. The
app therefore requires a named order with status `paid` (evidence: the
order status set `pending_payment | paid | failed | cancelled | expired`,
the staging card payment of 2026-11-02, order 1105, status `paid`, and the
same narrowing in pos-web). Risks either way:
- if the real success body lacks `order_id`/`order_number` or a top-level
  `status: "paid"` (or is wrapped in `data`), **every successful card
  payment shows as unconfirmed**: the cart is kept and card stays paused for
  the account on that device. A real staging success body must be captured
  and checked against the rule before release;
- `user-web` still shows success for any 2xx, including one that might
  describe a declined or pending payment.
The open questions are listed in `docs/API_INTEGRATION.md` §8.

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

### 3.12 Maintenance recovery — LOW (availability) — mitigated
One 503 still switches the app into the maintenance screen.

- **Recovery:** "Try again" re-checks the backend through
  `recheckMaintenance`. The check is an anonymous, read-only probe through
  `apiRequest`, and it is single-flight.
- **What clears it:** only a 2xx clears it, and only if no 503 arrived
  meanwhile. Session, cart and payment state are never touched.
- **Residual risk:** there is no dedicated health endpoint, so "available"
  means a public endpoint answered (`docs/API_INTEGRATION.md` §11).

### 3.13 Android cleartext for staging BLUE — UNKNOWN
Staging BLUE is HTTP. The Android cleartext policy for non-debug staging builds
(`apk`, `preview`) was not verified; generated native projects are not in the repo.

### 3.14 Committed Firebase client configs — NOTE
`google-services.json` and `GoogleService-Info.plist` are committed. These are
client configs, not secrets, but they identify the Firebase project.
Restrictions for those keys belong in the Firebase console.

### 3.15 Confirmed retries do not reconcile unknown payments — LOW (backend-dependent)
There is no payment-status lookup or established idempotency contract for
`/checkout/mobile/submit`. The user may explicitly choose "Pay again" after
the duplicate-charge warning and confirmed cart re-read (§2.8), including on
the same reservation. That enables a separate attempt; it does not prove the
earlier attempt failed, cancel its authorization/order, or prevent another
charge. Only backend reconciliation/status and idempotency can close that gap.
The backend's acceptance of a fresh payment on the same reservation remains
NOT VERIFIED.

### 3.16 Web BLUE returns to a locked session — NOTE (intentional)
Web BLUE leaves the app by full-page redirect and has no in-app terminal
handling, so the restored session is locked on return, including after a
BLUE failure. The default is conservative; Checkout now offers explicit
"Pay again" consent for a separate attempt on the still-current reservation
(§2.8), with no reconciliation of the earlier BLUE payment.

### 3.17 A 503 on submit is treated as definite non-completion — LOW
`paymentFailureKind` classifies 503 as maintenance, not unknown, so it does
not lock the session. This assumes the gateway rejects before processing.
Unverified; changing it is a product/backend decision.

### 3.18 `forgot-password/add-email` attaches an email without ownership proof — HIGH (backend)
Observed on staging (2026-10-06): `POST /auth/forgot-password/add-email`
`{ email, phone }` needs no authentication, and for an account without an
email it **persisted the supplied email** (it then appeared on the account's
profile, unverified) and sent the reset code there — before any OTP or other
proof that the caller owns the phone. An attacker who knows the phone number
of an email-less account can therefore attach an address they control and
reset that account's password: a potential account-takeover path.
- This is a **backend** security concern. The client exposing the step only
  after `email_required` (§2.2a) is not a security boundary: anyone can call
  the endpoint directly.
- The backend must establish ownership (e.g. a code to the phone, or a
  verified pending email) before permanently attaching a recovery email or
  letting it become recovery authority.
- Not established: whether the endpoint can overwrite an existing email (not
  probed), and any backend remediation. No fix is documented here because
  none has been verified.

### 3.19 Registration does not enforce password confirmation server-side — LOW/MEDIUM (backend)
Observed on staging (2026-10-06): a direct `POST /auth/register` whose
`password_confirmation` did not match `password` was accepted (201, account
created). The client's confirmation check is UX only and must not be treated
as enforcement. The backend should enforce (or explicitly drop) the
`confirmed` rule.

---

### 3.20 Card payments the client cannot reconcile — HIGH (backend)
- A CyberSource result lost before it reaches the app (process killed, form
  left, post-expiry grace period ended, WebView process gone, `mount()`
  rejected after an authorization) leaves a possible authorization with no
  order and no client record. Only backend reconciliation can recover it.
- An unresolved card result blocks its checkout and new card payments for
  the account by default, including a result the backend would reject as
  declined (the status is unverified). Explicit Checkout consent can permit
  a separate payment; deleting the My Tickets notice only hides it. Neither
  action confirms or resolves the earlier result. Resolving one requires a
  backend contract (idempotent resubmission, or an order or payment lookup) that does not
  exist yet.
- Backend idempotency for resubmitting the same result is not established, so
  the app never resubmits a result that reached the submit call.
- Card completion is a frontend narrowing not verified against the backend
  handlers (§3.5).
- **Backend requirements** (not implemented; see `docs/API_INTEGRATION.md`
  §8): a stable payment identifier tied to the order; idempotent submit for
  the same payment result; an authoritative status lookup by that
  identifier or checkout session; server-side reconciliation of
  authorizations without an order (fulfil or void); a defined policy for an
  authorization completed before reservation expiry but submitted after; a
  documented success and failure response contract.
- Web: two tabs writing the same `localStorage` slot are reconciled by
  reading each write back (up to three retries); an unbroken run of
  conflicting writes still fails as "not saved".
- On iOS, the SecureStore marker can survive uninstalling and reinstalling the
  app (Keychain behavior).

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
