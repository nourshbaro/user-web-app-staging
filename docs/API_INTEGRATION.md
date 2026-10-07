# API Integration — LFA User App

How the app talks to the LFA backend today, from source inspection of
`src/services/*`, `src/lib/config.ts`, and their call sites.

The backend is authoritative. This document records what the **client sends
and expects**; it is not a backend specification. Where the repository cannot
establish a contract, that is stated explicitly (§14). Never invent endpoints,
fields, or payloads to satisfy a design (§15).

Related: `docs/ARCHITECTURE.md` (owners), `docs/SECURITY.md` (invariants).

---

## 1. Configuration (`src/lib/config.ts`)

All configuration is read from `EXPO_PUBLIC_*` environment variables, which are
**inlined into the client bundle** (see `docs/SECURITY.md` §3.1).

| Variable | Used as |
| -------- | ------- |
| `EXPO_PUBLIC_LFA_API_BASE_URL` | `config.apiBaseUrl` — native request base (…`/api`) |
| `EXPO_PUBLIC_LFA_SITE_URL` | `config.siteUrl` — CyberSource target origin (native) and WebView `baseUrl` |
| `EXPO_PUBLIC_LFA_STORAGE_BASE` | `config.storageBaseUrl` — media URLs via `storageUrl()` |
| `EXPO_PUBLIC_LFA_API_PASSWORD` | `password` request header (see §3) |
| `EXPO_PUBLIC_LFA_API_TIMEOUT_MS` | request timeout (default 15000) |
| `EXPO_PUBLIC_CYBERSOURCE_UC_SCRIPT_URL` | Unified Checkout SDK script URL |
| `EXPO_PUBLIC_BLUE_PAYMENT_ALLOWED_ORIGIN` | only origin accepted for BLUE `payment_url` |
| `EXPO_PUBLIC_BLUE_REDIRECT_ORIGIN` | only origin whose `/payment/success|failed` is terminal |

Per-environment values live in `eas.json` build profiles (staging API for
development/preview/apk; production API for production) and a local,
gitignored `.env` (`.env.example` is the template). `environment.d.ts` types
only the first five variables.

The two BLUE origins are parsed by `configuredHttpOrigin`: a bare http(s)
origin with no credentials, path, query, or hash — otherwise empty, which
disables BLUE ("not configured for this environment").

---

## 2. Central client (`src/services/api.ts` → `apiRequest`)

Every JSON request goes through `apiRequest<T>(path, init)`:

- **URL**: native → `${config.apiBaseUrl}${path}`; web → `/api${path}` (the
  Expo server proxy, §4).
- **Headers**: `Accept: application/json`; `Content-Type: application/json`
  unless the body is `FormData`; `password` (native only, when configured);
  `Authorization: Bearer <token>` when a token applies; then caller headers.
- **Token selection**: the token comes from a fresh
  `captureAuthenticationSnapshot()` at call time. Options:
  - `overrideAuthorizationToken: null` → force anonymous.
  - `overrideAuthorizationToken: "<token>"` → pin a token.
  - `skipUnauthenticatedNotify: true` → a 401/403 does not end the session
    (used by all pre-login auth calls, logout, and anonymous device registration).
- **Timeout**: `AbortController` at `config.timeoutMs`.
- **Body**: parsed as JSON; non-JSON bodies become `null`.
- **Non-2xx**:
  - 503 → `activateMaintenance()` (§11).
  - 401/403 (unless skipped) → `invalidateAuthentication(snapshot)` for the
    generation that made the request; stale generations are ignored.
  - throws `ApiError(message, status, body)`, where `message` is
    `body.message ?? body.error ?? "Request failed with <status>"`.
- **Transport failure** → `ApiTransportError` with category `timeout` or
  `network` and a fixed user-safe message.
- `unwrapData(payload)` returns `payload.data` when present.

Exception: `profileService.orderPdf` performs its own `fetch` (binary body) but
replicates the same URL, header, timeout, 503, and 401/403 behavior.

---

## 3. Authentication headers and refresh

- Bearer token issued by login-family endpoints, read by `readToken` from
  `token | access_token | data.token | data.access_token`; user from
  `user | data.user | customer`.
- The static `password` header is attached to every native request and injected
  by the web proxy. Its purpose (backend gateway / API key) is not documented in
  this repository.
- **There is no token refresh endpoint or logic.** The session ends on 401/403
  or explicit logout. "Token refresh" in this codebase refers only to **FCM
  device-token** refresh (§10).

---

## 4. Web proxy (`src/app/api/[...path]+api.ts`)

Web builds use `web.output: "server"`. The route forwards `GET/POST/PATCH/DELETE`
`/api/*` to `EXPO_PUBLIC_LFA_API_BASE_URL` (falling back to the staging base when
unset), adds the `password` header server-side (from
`EXPO_PUBLIC_LFA_API_PASSWORD` or `API_PASSWORD`), forwards `Authorization`,
and streams PDF/octet-stream bodies with `Content-Disposition`. It returns 500
if no password is configured. It does not restrict which paths are forwarded.

---

## 5. Endpoint inventory (as called by the client)

Paths are relative to the API base. "Validated" means the client checks the
response shape at runtime and throws on mismatch.

### Auth — `src/services/auth.ts` (`authService`)
| Method & path | Body (client) | Notes |
| ------------- | ------------- | ----- |
| `POST /auth/login` | `email` **or** `phone`, then `password, remember` | Exactly one identifier (`LoginIdentifier`); see §5.1. May return `reason: "phone_required"` (2xx or error body) |
| `POST /auth/complete-phone` | `email, password, phone` | Saves session. Reached only after an **email** sign-in answered `phone_required` |
| `POST /auth/register` | `name, phone, password, password_confirmation`, and `email` only when given | Saves session. Email optional (§5.1) |
| `POST /auth/verify-otp` | `user_id` and/or `email`, `code` | Saves session. Used after Login / Register **only** when the backend returns an account id without a session token (`credentialOutcome`) |
| `POST /auth/resend-otp` | `user_id` and/or `email` | Staging requires `email` (2026-10-06); the screen offers resend only when the pending target has one |
| `POST /auth/check-email-verification` → `/auth/check-email` → `/auth/email-verification-status` | `email` | Tries in order, skipping 404/405; returns `null` if none exist |
| `POST /auth/forgot-password` | `email` **or** `phone` | Returns the raw answer; read by `forgotPasswordOutcome` (§5.2) |
| `POST /auth/forgot-password/add-email` | `email, phone` | `addRecoveryEmail`. Only after `email_required` for the current phone attempt (§5.2). Security concern: `docs/SECURITY.md` §3.18 |
| `POST /auth/forgot-password/verify-otp` | `email` **or** `phone`, `code` | One field: the attempt's recovery identity (`recoveryTarget`, §5.2). Staging accepts only `email`; `{ phone, code }` → 422 "The email field is required." (2026-10-07) |
| `POST /auth/reset-password` | `email` **or** `phone`, `code, password, password_confirmation` | Same recovery identity as verify. Staging accepts only `email`; with `phone` → 422 "The email field is required." (2026-10-07). Backend source not inspected |
| `GET /auth/me` | — | Validated (`isUser`); `email` may be `null` |
| `POST /auth/change-password` | `current_password, password, password_confirmation` | Session cleared afterwards |
| `POST /auth/profile-picture` | multipart `avatar` | Returns `{ avatar }` |
| `DELETE /auth/profile-picture` | — | |
| `DELETE /auth/account` | `password` | Session cleared afterwards |
| `POST /auth/logout` | — | Fire-and-forget with the captured token |

### 5.1 Auth identifiers, registration and the user record

Observed on staging (validation errors and responses, 2026-10-06; backend
source not inspected):

- **Login** validates `email` *required without* `phone` and vice versa, plus
  `password`. The client sends one identifier, never both
  (`identifierBody`). Wrong credentials answer 422 "Invalid credentials."
  for either identifier.
- **Phone representation:** the shared international-phone utilities
  (`src/lib/phoneNumber.ts`) validate the number for its country (Israel is
  excluded); `toBackendPhoneDigits` turns the E.164 value (`+96171123456`)
  into digits only, no `+` (`96171123456`). Login, register, complete-phone,
  recovery and add-email all send this form. (Staging also accepted a
  `+`-prefixed login phone; the client does not rely on it.)
- **Register** requires only `name`, `phone` and `password`. Email is
  optional: the client omits the field when empty and checks its format when
  given. The client still checks `password_confirmation` before submitting,
  but staging accepted a direct registration whose confirmation did not
  match — the backend does not enforce it (`docs/SECURITY.md` §3.19).
  The client requires a valid phone.
- **Nullable email:** an account created without an email returns
  `user.email: null` (register, login and `/auth/me`). `isUser` (`/auth/me`),
  the persisted-user decoder and `User.email` (`string | null`) accept it;
  checkout reads it null-safely. A phone-only account currently cannot pass
  checkout's existing "name and email" billing requirement, and the profile
  is read-only in the app (§14).

### 5.2 Password recovery

One owner: `src/lib/passwordRecovery.ts` (`recoveryReducer`, held by
`src/app/auth.tsx`). Steps: identify (Email | Phone) → add email (phone path,
`email_required` only) → code → new password → Sign in.

- **`POST /auth/forgot-password`** takes `{ "email": … }` or `{ "phone": … }`.
  Known and unknown emails (and unknown phones) receive the same generic 2xx:
  `"If that account is registered, a reset code has been sent."` A **phone
  account without an email** answers 2xx with
  `{ "reason": "email_required", "message": … }`. `forgotPasswordOutcome`
  branches on that `reason` only, never on message text.
- **Phone branching (implemented frontend behavior):**
  - phone + `reason: "email_required"` → **add email** (below);
  - phone + any other 2xx → **code step immediately**, bound to the phone
    that started the attempt (`phoneCodeSent`; never the live field). The
    toast shows the backend's own message, since the answer does not say
    where the code went. The flow never stays on the phone step and never
    asks for the account's email.
- **`POST /auth/forgot-password/add-email`**
  `{ "email": "<entered email>", "phone": "<digits-only phone>" }`. The client
  calls it only after the **current** phone attempt answered
  `email_required`, and sends the phone bound to that answer (never the live
  phone field). A 2xx (generic message) means the email was saved and the
  code sent to it; only then does the flow move to the code step for that
  address. An error (e.g. 422 "Account not found.", invalid email) keeps the
  step and the entered values, with the backend message inline.
- **Recovery identity (client):** verify, reset and resend send one field,
  the attempt's `recoveryTarget`: the address the backend sent the code to
  (email path, or after add email), otherwise the phone bound to the attempt.
  There is none before a code exists. The client never invents an email.
- **Current staging limitation (verified 2026-10-07, non-existent
  identifiers only):** `forgot-password/verify-otp` `{ phone, code }` → 422
  "The email field is required."; `reset-password` with `phone` → 422 "The
  email field is required." The generic phone answer carries neither the
  account's email nor a token. So **Phone → code is implemented, but Phone →
  code → new password → Sign in is not yet end-to-end functional**: Verify on
  a phone-bound code shows the backend's 422 message inline and keeps the
  step. The email path and phone → add email → code (keyed by the added
  email) are unaffected. Backend dependency (§5.3).
- **No "unknown email → try phone" branch:** the generic answer is identical
  for known and unknown emails, so the client cannot (and must not) decide
  that an email is unavailable. The email path always continues to the code
  step (an unknown address therefore still reads "Code sent"); the user can
  go Back and choose Phone. Backend dependency (§5.3).
- **Code entry:** six visual cells over one numeric six-digit value
  (`src/components/account/OtpCodeInput.tsx`, one native input: numeric
  keyboard, paste, iOS `oneTimeCode` / Android `sms-otp` autofill). Resend
  re-sends `forgot-password` for the same recovery identity (address or bound
  phone); there is no client countdown.
- **Attempts:** every request carries the attempt it was sent in; editing the
  identifier, switching method, Back, cancel and completion start a new
  attempt, so a late success or error for an earlier identifier is dropped.
  Submit and "Resend code" share the synchronous auth submission guard.
- **Rate limiting (observed on staging, not a contract):** about 3 recovery
  requests per window of roughly 6 minutes, then 429 "Too many requests."
  with `Retry-After`. The client shows the error and does not retry.
  (Re-observed 2026-10-06: the throttle applies per identifier — a different
  address was accepted while the first was throttled.)

### 5.3 Required recovery flow — PENDING BACKEND

Product requirement (2026-10-06; phone branching rule 2026-10-07). Status of
each branch:

```
PHONE  generic 2xx     → OTP                                (frontend implemented, §5.2)
                         → new password → Sign in           (blocked: verify / reset reject phone)
PHONE  email_required  → add email → OTP → new password → Sign in   (implemented, §5.2; §3.18 risk)
EMAIL  exists          → OTP → new password → Sign in       (implemented)
EMAIL  unavailable     → backend message → "Try phone number" → phone flow   (blocked: no signal)
```

Re-probed 2026-10-07 (non-existent identifiers only): `verify-otp`
`{ phone, code }` and `{ identifier, code }` → 422 "The email field is
required."; `reset-password` with `phone` → 422 "The email field is
required."; the generic phone answer is `{ message }` only. Other field names
(`recovery_token`, `token`, …) could not be probed (429 throttle). An unknown
email still gets the generic 2xx (2026-10-06).

**Backend change request** (a recommendation; none of it is an implemented
contract):
1. **`POST /auth/forgot-password` outcomes.** Keep one generic success for
   anything that sent a code, but return a machine-readable `reason`:
   `code_sent` (a code was sent — to the account's email or phone; the
   response never includes the address), `email_required` (phone account
   with no email; unchanged), and, if product accepts the enumeration
   trade-off below, `email_not_found` for an email request with no
   recoverable account.
2. **Recovery token.** Every `code_sent` / add-email success returns an
   opaque, single-use, short-lived `recovery_token` bound server-side to the
   account and the identifier used. The client stores it only in screen
   memory.
3. **`POST /auth/forgot-password/verify-otp`** accepts
   `{ recovery_token, code }` (instead of requiring `email`), and returns a
   new token that authorizes only the reset.
4. **`POST /auth/reset-password`** accepts
   `{ recovery_token, password, password_confirmation }` and enforces the
   confirmation server-side (`docs/SECURITY.md` §3.19).
5. **Unavailable email.** 404 or 422 with `reason: "email_not_found"` and a
   user-facing `message`, which the client will display verbatim; the exact
   wording is the backend's to define (suggested: "We couldn't find an
   account with that email. Try your phone number instead."). The client
   will then offer "Try phone number". Note: any distinct answer reveals
   whether an email is registered (account enumeration); it should be
   rate-limited per IP and identifier, or product may keep the generic
   answer and accept that this branch cannot exist.
6. **Why a token, not email/phone between stages:** it never exposes the
   account's email to a phone-initiated flow, keeps verify / reset bound to
   the attempt that requested the code (so a code cannot be replayed against
   another identifier), and lets the backend expire or revoke an attempt.
7. **Add-email ownership** (`docs/SECURITY.md` §3.18): attaching an email
   must require proof of phone ownership first (e.g. a code to the phone
   that yields the `recovery_token`), and the email should become recovery
   authority only after it is verified.

If the backend instead accepts `{ phone, code }` on verify / reset, the
current client completes the phone flow with no change (it already sends the
bound phone). If it ships the token design, the client change is confined to
`authService` (token in the request bodies), `forgotPasswordOutcome` (the new
reasons) and the recovery reducer / `recoveryTarget` (holding the token
instead of the email or phone).

### Matches — `src/services/matches.ts` (`matchesService`)
| Method & path | Notes |
| ------------- | ----- |
| `GET /matches/scheduled?team=&stadium=&date=` | Normalized from array, `matches`, `scheduled_matches`, or `items` |
| `GET /matches/scheduled/filters` | `{ teams, stadiums }` (optionally under `data`) |
| `GET /matches/single/{id}` | Match detail (`ApiMatchDetail`): competition, season, matchday, scores, nested live clock, events, stats, stadium with map and zones (see below) |
| `GET /matches/{matchId}/zones/{zoneId}/seats` | `{ zone, seats }`; seat selectable iff `status === "available"` |

All four go through the shared in-memory read cache (§13, "Read cache";
`docs/ARCHITECTURE.md` §5a), keyed by the full path including every query
parameter, with per-resource freshness (live lists and live match details,
and seats, are kept much shorter than scheduled data). `force = true`
bypasses it (pull-to-refresh, the Live interval poll, the pre-commit match
re-check). Not user-scoped (public data).

**Scheduled matches on Home and Matches:**
- Both screens call `matchesService.list` / `.filters` through
  `useScheduledMatches`; no new endpoint was introduced.
- The Matches filters map to the existing `team`, `stadium` and `date` (YYYY-MM-DD) parameters.
- **`status` (confirmed by the user; verified on staging 2026-09-29):**
  `?status=live` and `?status=completed`; omitted = the scheduled list.
  Any other value → 422 "The selected status is invalid." `team`, `stadium`
  and `date` compose with `status` server-side. Used by Matches (Upcoming /
  Live / Results) and Home (Live now, Latest result).
- **Observed fields (staging):** a bare array of `id`, `match_date`
  ("YYYY-MM-DD"), clock-only `kickoff_at` ("HH:MM:SS"), `status`
  (`scheduled`, `live`, `completed`), `home_score`/`away_score` (numbers on
  results and live matches, otherwise null), `matchday`, `round_name`,
  `stadium` {`id`, `name`}, and `home_team`/`away_team` (`name`,
  `short_name`, `logo`). The client models `home_score`/`away_score`
  beyond the existing fields.
- **Live list fields (`?status=live`, confirmed):** also `clock_minute`,
  `clock_running`, `clock_updated_at`, flat statistics (`possession_home`,
  `shots_home`/`shots_away`, `shots_on_target_home`/`_away`,
  `corners_home`/`_away`, `fouls_home`/`_away`) and status timestamps/reason
  (`reason`, `status_changed_by`, `status_changed_at`) where returned. They
  are **flat** on the list item (`ApiMatch.clock_minute`, …), unlike the
  single-match response below; the two shapes are never merged into one type.
  Staging (2026-10-01) also returns them on `?status=completed` items.
- **Authoritative live minute in lists:** `clock_minute` / `clock_running`
  of the list item itself (`liveClockOf`, `src/lib/matchDiscovery.ts`), shown
  only for a `live` status ("LIVE 67'"; the dot blinks only while
  `clock_running` is true). A null / negative / non-numeric minute shows plain
  "Live". No per-card detail request and no client clock.
- **Competition matches carry no clock** (`/competitions/{id}/matches` has no
  `clock_*` fields): competition cards show "Live" without a minute.
  **Backend dependency:** the list clock fields on that endpoint.
- No favourite or availability/sold-out data; the app does not derive any.
  `/matches/scheduled/filters` lists teams/stadiums of scheduled fixtures.

**Single match (`GET /matches/single/{id}`, confirmed on staging
2026-09-30 with `/matches/single/14` and `/matches/single/16`):**
- `id`, `match_date`, `kickoff_at`, `status`, `home_team`/`away_team`
  {`id`, `name`, `logo`};
- `competition` {`id`, `name`, `short_name`, `slug`, `logo`}; `season`
  {`id`, `label`, `is_current`}; `matchday`, `round_name` (nullable),
  `matchday_label`;
- `home_score`/`away_score`, **each independently nullable** (match 16 had
  `1` / `null` while live and after completion); `clock` {`minute`
  (nullable), `running`} (**nested**, unlike the flat list fields);
- `events[]` (`ApiMatchEvent`): `id`, `type`, `team` {`id`, `name`,
  `short_name`, `logo`}, `player` {`id`, `name`, `shirt_number`},
  `player_in`/`player_out` (nullable), `minute`, `extra_minute` (nullable).
  - **Confirmed `type` strings (exact):** `goal`, `yellow_card`, `red_card`,
    `substitution`. Sources: the admin event contract
    (`admin-dash` `MATCH_EVENT_TYPES`) and staging `/matches/single/17`
    (2026-09-30), which returned all four.
  - **Substitution:** the players are in `player_in` / `player_out`, each
    independently nullable as the backend sends it (staging: `player: null`,
    both supplied). Goals and cards carry `player`, with `player_in` /
    `player_out` null.
  - **Forward compatibility:** any other `type` (including near-misses such
    as `yellow` or `Substitution`) is a neutral event. The client never infers
    the type from `player_in` / `player_out`, `player`, text or other event
    contents; the backend `type` alone decides (`timelineKind`).
  - Example (match 16): goal, Nejmeh, "Sierra Leone" #17, minute 1 → "1'";
    minute 45 + extra 2 → "45+2'";
- `stats` {`possession`, `shots`, `shots_on_target`, `corners`, `fouls`},
  each `{home, away}` or null (example, match 16: possession 3/97, the others
  1/1);
- `stadium` {`id`, `name`, `location`, `map_image`, `zones[]` {`id`,
  `name`, `has_seats`, `shape_type`, `shape_data`, `price`, `currency`,
  `capacity` (nullable)}}.
- **Purchasability:** only `status: "scheduled"` exposes ticket purchasing
  in the app. Live, completed (and any other status) get the match
  information / result view. `stadium.zones` can still be present for them
  and **does not** imply that tickets are on sale. The selection commit
  re-reads this endpoint (forced, uncached) immediately before any cart
  mutation and sends nothing unless it is still scheduled.
- Display facts come only through `matchDetailFacts`
  (`src/lib/matchDetailFacts.ts`): a null score side is not 0, a null minute
  is not a live minute (there is no client-side clock), empty events are no
  timeline, and a null statistic is omitted, never zero. Media paths go
  through `storageUrl()`.

### Cart — `src/services/cart.ts` (`cartService`)
| Method & path | Body | Notes |
| ------------- | ---- | ----- |
| `POST /cart/items` | `match_id, stadium_zone_id, quantity?` or `seat_ids?`, `checkout_session_id?` | Omitting the session ID starts a new session |
| `GET /cart?checkout_session_id=` | — | 404 ⇒ session gone |
| `PATCH /cart/items/{lock_key}` | `quantity` (or `seat_ids`) | Sets, not increments |
| `DELETE /cart/items/{lock_key}` | — | Followed by a refresh |

Responses must contain `cart` and `checkout_session_id` or the client throws.
`expires_at` drives the reservation timer. Items come from `cart.items` or are
flattened from `cart.matches[].items`. `total` is coerced to number; `currency`
defaults to `USD`.

### Checkout and payment — `src/services/checkout.ts` (`checkoutService`)
| Method & path | Body | Notes |
| ------------- | ---- | ----- |
| `POST /payments/cybersource/capture-context` | `checkout_session_id, target_origins[], locale: "en-us"` | Returns `capture_context` (root or `data`) |
| `POST /checkout/mobile/submit` | `CheckoutSubmitRequest` (`src/types.ts`) | Both payment methods |

`CheckoutSubmitRequest`: `checkout_session_id`, `billing { name, email, phone,
country: "LB" }`, `tickets_by_match: { [matchId]: [{ holder_name }] }`,
`payment_method: "cybersource" | "blue"`, and for card
`payment.transient_token`.
`CheckoutSubmitResponse` (all optional): `order_id`, `order_number`,
`reference`, `payment_reference`, `status`, `payment { payment_url, reference,
payment_reference, status }`. It identifies **no ticket**. "View my ticket"
after success therefore uses the submitted `tickets_by_match` key when the
order covered exactly one match (`singlePurchasedMatchId`; display-only
`match_id` result param) and the backend `order_code` of that match's portal
tickets (`ticketFocusIndex`). Several matches → the My Tickets list.
**Backend dependency** for a direct ticket link: ticket codes (or the order's
match ids) in the submit / BLUE return response.

### Portal (orders and tickets) — `profileService` in `src/services/auth.ts`
| Method & path | Notes |
| ------------- | ----- |
| `GET /portal/matches?filter=all\|upcoming\|past` | Paginated `{ data, meta.total }`; validated (`isPortalMatch`) |
| `GET /portal/tickets?match_id=` | Validated (`isPortalTicket`); `qr_image` may be absent, null or a string (every other field unchanged) |
| `GET /portal/tickets/{ticket_code}` | When a listed ticket has no usable QR, only its `qr_image` is taken (`withBackendQrs`) |
| `GET /portal/orders/{orderNumber}` | Payment details; `ORD-` prefix stripped by the caller |
| `GET /portal/orders/{orderId}/pdf` | Binary; `Accept: application/pdf,…` |
| `GET /portal/orders` | Defined, **not called** by any screen |
| `GET /portal/notifications` | `notificationInboxService.list` (`src/services/notificationInbox.ts`); see §14 |
| `GET /portal/notifications/unread-count` | `notificationInboxService.unreadCount`; the Home bell number |

Screens read `/portal/matches` and `/portal/tickets?match_id=` through
`portalReads` (`src/services/cachedReads.ts`): a short-lived, memory-only,
user-scoped read cache over these unchanged service methods (§13). The
per-ticket QR fallback, orders and PDF are not cached.

### Other
| Method & path | Owner | Notes |
| ------------- | ----- | ----- |
| `POST /devices` | `registerAnonymousDevice` / `registerAuthenticatedDevice` | `{ token, platform: "android" \| "ios" }` |
| `GET /app-versions/check?platform=&version=` | `loadAppVersionCheck` | Public, no token, once per launch; see §14 |
| `GET /ads?placement=app_banner` | `adsService` | Items filtered field-by-field; invalid items dropped; read cache (§13) |
| `GET /legal/privacy-policy`, `GET /legal/terms-of-use` | `legalService` | String or object with content key; HTML stripped to text |

---

## 6. Cart and reservation behavior

- The server owns contents, prices, totals, seat locks, and expiry. The client
  never computes totals authoritatively (`cart.total` is displayed as returned).
- The client persists only `{ version: 1, sessionId, expiresAt }` under
  `lfa_cart_session_id`, and only while authenticated.
- A rejected session on add (404) is dropped and the add is retried once
  without a session ID.
- A 404 on refresh clears the local session; other refresh errors keep it.
- Mutations are serialized; responses are published only if the captured cart
  session ticket is still current.
- The cart methods resolve a `CartPublication` (confirmed / unconfirmed). This
  is a **frontend** publication result derived from the existing session
  guards. The backend returns no such field, and cart endpoint payloads are
  unchanged.

Full state model: `docs/ARCHITECTURE.md` §8.

---

## 7. Seat and zone handling

- Zone type is backend-defined: `has_seats: true` → reserved seating with seat
  IDs; otherwise general admission with a quantity.
- Seat availability is read per zone (`/matches/{m}/zones/{z}/seats`,
  briefly cached unless forced; §13). A drafted seat is sent only if it is in
  the current successful seat response, still `available`, and not already in
  the cart. Any snapshot can age, so the backend add remains the final
  authority.
- GA quantity changes are local drafts until the user commits; commit sends
  `add` for new lines, `PATCH` (set) for changed lines, `DELETE` for zero. The
  payloads are unchanged; success is decided from the published cart
  (`docs/ARCHITECTURE.md` §8).
- The stadium map is a backend-provided image (SVG or raster) plus zone
  polygons; the client does not own stadium geometry.

---

## 8. CyberSource boundary

- The client never sees card data. Unified Checkout (Visa Acceptance SDK,
  loaded from `EXPO_PUBLIC_CYBERSOURCE_UC_SCRIPT_URL`) runs in a WebView
  (native) or the page (web) and returns a **transient token**.
- The capture context is requested per cart session with `target_origins` =
  `config.siteUrl` (native) or `window.location.origin` (web). Stale responses
  are discarded via `createRequestAuthority`.
- The transient token is sent once to `/checkout/mobile/submit`. Only the
  backend authorizes the charge.
- Success is inferred from a **2xx** submit response for the current cart
  session. The response `status` is displayed, not evaluated.
- Card entry uses `createCheckout()` (with CyberSource's own "Checkout with
  card" selection step). `createTrigger("PANENTRY")` does not work with the
  card-only capture context in SDK 1.0.0–1.3.0 because of a vendor SDK defect;
  no capture-context change (such as enabling `CLICKTOPAY`) is requested. See
  `docs/SECURITY.md` §2.8.

---

## 9. BLUE boundary

- `/checkout/mobile/submit` with `payment_method: "blue"` must return
  `payment.payment_url`. The client accepts it only if its origin equals
  `EXPO_PUBLIC_BLUE_PAYMENT_ALLOWED_ORIGIN` and its path is exactly
  `/payment/<id>` with no encoded separators, credentials, or hash.
- The returned order/payment references are stored with the pending attempt; a
  retry for the same cart session reuses the stored URL instead of resubmitting.
- Terminal detection is client-side URL classification (`classifyBlueTerminalUrl`):
  `EXPO_PUBLIC_BLUE_REDIRECT_ORIGIN` + `/payment/success` or `/payment/failed`, or
  `lfa-app://checkout/success|failed` (optional `provider=blue`).
- No client call verifies payment status with the backend after the terminal
  redirect. Tickets and orders shown later come from the portal API.

---

## 10. Device and push registration

- FCM token from `@react-native-firebase/messaging` (`getFcmDeviceToken`),
  only on physical devices with notification permission granted.
- `sendDeviceToken` checks the current session: no token → anonymous
  `POST /devices` (`overrideAuthorizationToken: null`); token → authenticated
  `POST /devices` using the live token.
- Sent on app start **only if permission is already granted** (the app never
  prompts at startup), after an explicit opt-in that grants it (onboarding
  "Turn on notifications" or Settings), on every authenticated token change,
  and on every FCM token refresh. Re-sending the same token authenticated after
  login is intentional (device association). Whether the backend deduplicates
  is not established here.
- Logout does not unregister the device.

---

## 11. Maintenance responses

A 503 from any request activates a process-wide maintenance flag; the whole
navigator is replaced by the v3 maintenance screen (`docs/ARCHITECTURE.md` §13).

- **Recovery:** "Try again" (`recheckMaintenance`) sends one anonymous
  `GET /matches/scheduled/filters` through `apiRequest`. This is an existing
  public, read-only endpoint; no new endpoint is used.
  - A 2xx clears the flag, unless another 503 arrived meanwhile.
  - Anything else keeps it.
  - It is single-flight, with no polling.
- **Backend dependency (open):** the backend has no dedicated health or
  maintenance-status endpoint. The probe treats "this public endpoint
  answers 2xx" as "available again". If maintenance ever leaves public
  match data served while other endpoints return 503, the screen clears.
  The next 503 re-enters it.

---

## 12. Error handling

- `userFacingError(error, fallback)` (`src/lib/userFacingError.ts`): transport
  errors → their fixed message; `ApiError` → backend `message` / `error` / first
  validation error; anything else → the caller's fallback.
- `backendProvidedError` behaves the same and no longer falls back to
  `ApiError.message`: beyond the body text it only ever added the transport
  string `"Request failed with <status>"`, which is never shown to users
  (likewise the password-change sheet).
- `paymentError()` is the standard payment fallback copy.
- Backend messages are shown verbatim when present. Raw exception text and stack
  traces are not shown.
- Exception: Match Details classifies failures by HTTP status and transport
  category (`ticketErrorKind` in `src/lib/ticketSelection.ts`) and shows only
  catalog messages, never backend wording. A structured backend error-code
  contract would allow more specific messages, e.g. ticket limits (not
  established; §14).

---

## 13. Stale-request and session protection

| Mechanism | Where | Guards |
| --------- | ----- | ------ |
| Authentication generation | `src/services/api.ts`, `src/lib/authSessionOwnership.ts` | 401/403 invalidation, restore, logout, user refresh |
| User-scoped cache generation | `src/lib/userScopedCache.ts` | Tickets list/detail and PDF results after identity change; scopes the portal read cache |
| Read cache | `src/lib/queryCache.ts` (see below) | Duplicate in-flight GETs, older responses overwriting newer ones, failures stored as data |
| Request authority | `src/lib/requestAuthority.ts` | Match detail, seats, tickets, capture context |
| Cart session tickets | `src/lib/cartSessionAuthority.ts` | All cart mutations and payment completion |
| Cart refresh guard | `src/lib/cartRefreshPolicy.ts` | Out-of-order refresh responses |
| Checkout submission authority | `src/lib/checkoutSubmissionAuthority.ts` | BLUE submit result vs unmount/session change |
| Single-flight | `createSingleFlight` (`src/lib/cartSessionRecovery.ts`) | Concurrent `addItem` |
| Cart publication result | `src/lib/cartPublication.ts` (returned by `CartContext`) | Treating a resolved cart mutation as confirmed success |
| Auth submission guard | `src/lib/authSubmissionGuard.ts` | Double-submitted auth forms; recovery submit vs "Resend code" |
| Password-recovery attempts | `createRecoveryAttempts` / `recoveryReducer` (`src/lib/passwordRecovery.ts`) | Late recovery answers (success or error) for an earlier identifier, method or step |
| Identity-keyed remounts | `CartProvider key`, `withAuthRequired key` | All screen and cart state on account switch |

New API-backed features must use the existing mechanism for their domain rather
than adding a parallel one.

### Read cache

Mechanics, ownership and invalidation are in `docs/ARCHITECTURE.md` §5a. In
short: memory only; keys are the full request (path and parameters); identical
concurrent reads share one request; the latest request wins (a superseded
response is neither cached, acted on, nor returned as data); failures are not
cached; screens seed from it on remount and revalidate when stale. Live polling,
pull-to-refresh and explicit Retry are always forced; focus / foreground
re-reads respect freshness. Invalidation: a successful checkout and
unknown-payment recovery (`/tickets?refresh=payment`) drop portal reads; an
accepted live-state change drops the other match lists, the affected match
details and competition matches / standings, and mounted owners re-read; a
push received or opened drops the notification inbox and unread count; an
identity change drops portal and notification reads.

Current policy (tuning, not a contract — change it in the owning module):

| Resource | Fresh (no request) | Shown while revalidating up to | Owner |
| -------- | ------------------ | ------------------------------ | ----- |
| Scheduled / completed match lists, non-live match detail | 5 min | 30 min | `MATCH_POLICIES` (`matches.ts`) |
| Live match list, live match detail | 30 s | 2 min | `MATCH_POLICIES.liveList` / `.liveDetail` |
| Seat availability | 30 s | 30 s | `MATCH_POLICIES` |
| Match filter options | 30 min | 2 h | `MATCH_POLICIES` |
| Competition list / standings / matches | 30 min / 5 min / 2 min | 2 h / 30 min / 15 min | `COMPETITION_POLICIES` (`cachedReads.ts`) |
| Portal matches / tickets (per user) | 30 s / 60 s | 10 min | `PORTAL_POLICIES` (`cachedReads.ts`) |
| Notification inbox / unread count (per user) | 30 s / 30 s | 10 min / 5 min | `NOTIFICATION_POLICIES` (`cachedReads.ts`) |
| Ads banner | 10 min | 1 h | `APP_BANNER_POLICY` (`ads.ts`) |

Not cached: `/cart*`, `/checkout/mobile/submit`, the CyberSource capture
context, BLUE, `/auth/*` (including `/auth/me`), `/devices`, legal documents,
`/portal/tickets/{code}`, `/portal/orders*`. `/app-versions/check` is not in the
read cache either: it is asked once per launch (memoized in `appUpdate.ts`).

---

## 14. Contracts not established by this repository

- Authoritative request/response schemas for any endpoint (no OpenAPI or shared
  types in the repo; types in `src/types.ts` are client-side expectations).
- Whether `/checkout/mobile/submit` returns non-2xx for declined or failed card
  payments.
- Server-side idempotency of `/checkout/mobile/submit` for a repeated session.
- Backend behavior on BLUE callback, and how web BLUE results are finalized.
- The meaning of the `password` header and of `remember` on login.
- **Password recovery by phone for an account that has an email** (§5.2,
  change request §5.3): needs a recovery-token (or phone) contract for
  verify / reset. Until then the branch cannot continue in the app.
- **Unknown email → phone guidance** (§5.2, §5.3): the generic answer
  deliberately hides whether an email exists; a distinct backend answer
  (with its enumeration trade-off) is required, not client inference.
- **Ownership before `add-email` persists** (§5.2, `docs/SECURITY.md` §3.18).
- **Server-side `password_confirmation` on register** is not enforced on
  staging (`docs/SECURITY.md` §3.19).
- **Phone-only accounts and checkout:** checkout requires a billing email,
  which a phone-only account lacks and cannot add in the app. Whether
  `/checkout/mobile/submit` accepts a billing email that is absent, or
  how the profile gains one, is a backend/product decision.
- **BLUE order left open when paying by card.** "Continue with BLUE" makes the
  backend create a BLUE order (staging: the BLUE page shows its order id).
  The app lets the user pay by card afterwards (a separate submit for the
  same `checkout_session_id`, as the web client already does); it cannot
  cancel the BLUE order or read its status, and submit idempotency is
  unconfirmed. Whether the backend accepts a card submit while a BLUE order
  is pending, and what happens if that BLUE order is approved after a card
  success, is backend-owned and unverified from the client.
- **App version check (integrated; verified on staging 2026-10-05).**
  `GET /app-versions/check?platform=android|ios&version=<installed>` →
  `{ data: { update_required, update_available, latest_version,
  min_supported_version, store_url, message } }`.
  - **Staging observation (2026-10-06 verification):** app version `1.1.4`
    received a required update with minimum supported version `1.4.0`.
    This is the backend policy observed on that date, not a permanent
    requirement or a version hardcoded by the client.
  - **Client:** `loadAppVersionCheck` (`src/services/appUpdate.ts`), once
    per launch, using `Platform.OS` and `Constants.expoConfig.version` from
    the running app (the binary's Expo config in a store build, the dev
    server manifest in a development client). The request uses
    `overrideAuthorizationToken: null` and `skipUnauthenticatedNotify: true`:
    no session token is sent and a 401/403 cannot invalidate authentication.
    `parseAppVersionCheck` / `decideUpdate`
    (`src/lib/appUpdatePolicy.ts`, `docs/ARCHITECTURE.md` §13). The backend
    flags decide; the app does not compare versions itself. Required wins if
    both flags are true. System-state priority is maintenance, required
    update, optional update, then normal app. Required updates block without
    dismissal; optional updates can be dismissed with "Not now" or Back.
  - **Validation (fail open):** both flags must be booleans; version fields
    must be dotted numbers (otherwise ignored); `store_url` must be this
    app's official listing —
    `https://play.google.com/store/apps/details?id=com.lfaticketing.app`
    exactly, or `https://apps.apple.com/[cc/]app/[name/]id<digits>`. An
    update without such a listing is not shown (the user could not update).
    Network failures, malformed answers and unusable installed versions
    fail open; web does not request a native version check. Store URLs are
    validated again by the client when the user opens the store.
  - **`message` contract assumption:** plain text; each sentence ending in
    "." is one bullet. A period ends a point only when followed by whitespace
    or the end of the text, so versions (`2.5.0`), domains and decimals stay
    whole; an abbreviation followed by a space (`e.g. x`) would split. Empty
    and punctuation-only segments are dropped; at most 12 points. Never
    rendered as HTML.
- **Notifications inbox (integrated; read-only).**
  `GET /portal/notifications` → `{ data: [{ id, title, body, data,
  target_type, match, sent_at, is_unread }] }` and
  `GET /portal/notifications/unread-count` → `{ unread_count }` (both
  authenticated; 200 on staging for a signed-in account, 2026-10-05).
  - `match` (nullable): `id`, `match_date`, `kickoff_at`, `status`,
    scores, clock, `home_team` / `away_team` {`id`, `name`, `short_name`,
    `logo`}; every field may be null. `data` is not used.
  - Only `target_type === "match"` with a numeric `match.id` opens Match
    Details. Unread treatment is `is_unread === true` only.
  - **Backend gap: no mark-read mutation.** Opening a notification does not
    change `is_unread`, and the count never drops in the app; v3's "Mark
    all as read" is not offered until such an API exists.
- Ticket `qr_image` representation. Only raster base64 data URIs are
  established (this repo's fixtures, and the LFA web client's allowlist for
  the same API). Whether production ever sends an http(s) URL, a storage path
  or SVG is **unconfirmed**; such values are shown as "QR unavailable" until
  the backend confirms a representation. Whether the list response actually
  omits the QR (and the detail always carries it) is also unconfirmed against
  a signed-in account.
- Ticket `status` value set. The app maps `valid`/`used`/`checked_in`/`expired`/`cancelled` (`ticketVisualState`); other values are shown with their own label. Not verified against a signed-in staging account.
- **Competitions (confirmed; integrated in `competitionsService`,
  `src/services/competitions.ts`; screens read them through
  `competitionReads`, the read cache in §13).** Public endpoints and their
  confirmed response shapes — do not assume other fields:
  - `GET /competitions` → `data[]`: `id` (the competition ID source), `name`,
    `short_name` (nullable), `slug`, `logo` (backend media path, e.g.
    `competitions/logos/….jpg`), `format` (e.g. `"league"`).
  - `GET /competitions/{id}/standings` → `data`: `competition` {`id`, `name`,
    `short_name`}, `season` {`id`, `label`, `is_current`}, `standings[]`
    {`rank`, `team` {`id`, `name`, `short_name`, `logo`}, `played`, `won`,
    `drawn`, `lost`, `goals_for`, `goals_against`, `goal_difference`,
    `points`}.
  - `GET /competitions/{id}/matches` → `data[]`: `id`, `match_date`,
    `kickoff_at`, `status` (backend-controlled), `matchday`, `round_name`
    (nullable), `matchday_label`, `home_team`/`away_team` {`id`, `name`,
    `short_name` (nullable), `logo`}, `home_score`/`away_score` (nullable),
    `stadium` {`id`, `name`, `location`}.
  - Logos are media paths resolved with `storageUrl()` (`src/lib/config.ts`).
  - **Standings 404 is ambiguous (staging, 2026-10-01):** the cup
    competition (2), an unknown id (999), a non-numeric id, a misspelled
    route and an unknown route all return the identical
    `404 {"message":"Endpoint not found."}`. There is no machine-readable way
    to tell "this competition has no table" from an error, so the app shows
    a 404 as "Standings unavailable" (retryable), never as "No standings".
    Only a successful `standings: []` is "No standings" (league 1 on
    staging). A response without a `standings` array, or with an incomplete
    row, is rejected as malformed. **Backend dependency:** a distinct,
    machine-readable signal (e.g. `200` with `standings: []`, or an error
    code) for competitions that have no table.
  - **Discrepancy observed:** `/competitions/1/matches` listed match 7 as
    `scheduled` while `/matches/single/7` returned `completed`. Match Details
    decides from its own single-match status, so purchasing stays gated.
- **Kickoff timezone:** the backend sends `match_date` plus a clock-only
  `kickoff_at` with no zone. The app reads them as local wall-clock time,
  preserving existing behavior. The authoritative timezone is not established
  by this repository, so do not introduce UTC (or other) conversion without
  backend evidence.
- Single-match event types other than `goal` (none observed yet).
- Structured error codes for cart/seat rejections (e.g. ticket limit vs seat
  taken); the client can only distinguish HTTP status classes.
- Idempotency of cart mutations: a request that times out may or may not have
  been applied, so the client re-reads the cart before retrying.
- `/devices` deduplication and whether a device can be detached on logout.
- Which of the three email-verification endpoints actually exists.

---

## 15. When a design needs data the API lacks

Do not fabricate it and do not add speculative endpoints. Report:

- desired UX and affected screen,
- current endpoint and the missing field/behavior,
- any legitimate client-side fallback (derived only from real data),
- the backend dependency, if required.

Backend changes are coordinated separately.
