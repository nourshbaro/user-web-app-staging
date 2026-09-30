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
| `POST /auth/login` | `email, password, remember` | May return `reason: "phone_required"` (2xx or error body) |
| `POST /auth/complete-phone` | `email, password, phone` | Saves session |
| `POST /auth/register` | `name, email, password, password_confirmation, phone` | Saves session |
| `POST /auth/verify-otp` | `user_id` and/or `email`, `code` | Saves session |
| `POST /auth/resend-otp` | `user_id` and/or `email` | |
| `POST /auth/check-email-verification` → `/auth/check-email` → `/auth/email-verification-status` | `email` | Tries in order, skipping 404/405; returns `null` if none exist |
| `POST /auth/forgot-password` | `email` | |
| `POST /auth/forgot-password/verify-otp` | `email, code` | |
| `POST /auth/reset-password` | `email, code, password, password_confirmation` | Code and tests agree; the sibling `user-web` client sends the same field (backend source not inspected) |
| `GET /auth/me` | — | Validated (`isUser`) |
| `POST /auth/change-password` | `current_password, password, password_confirmation` | Session cleared afterwards |
| `POST /auth/profile-picture` | multipart `avatar` | Returns `{ avatar }` |
| `DELETE /auth/profile-picture` | — | |
| `DELETE /auth/account` | `password` | Session cleared afterwards |
| `POST /auth/logout` | — | Fire-and-forget with the captured token |

### Matches — `src/services/matches.ts` (`matchesService`)
| Method & path | Notes |
| ------------- | ----- |
| `GET /matches/scheduled?team=&stadium=&date=` | Normalized from array, `matches`, `scheduled_matches`, or `items` |
| `GET /matches/scheduled/filters` | `{ teams, stadiums }` (optionally under `data`) |
| `GET /matches/single/{id}` | Match detail (`ApiMatchDetail`): competition, season, matchday, scores, nested live clock, events, stats, stadium with map and zones (see below) |
| `GET /matches/{matchId}/zones/{zoneId}/seats` | `{ zone, seats }`; seat selectable iff `status === "available"` |

All four are cached in a module-level map for 5 minutes, keyed by path;
`force = true` bypasses the cache (pull-to-refresh). Not user-scoped (public data).

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
  Only `type: "goal"` has been observed; other types are shown as a neutral
  event with no inferred meaning. Example (match 16): goal, Nejmeh, "Sierra
  Leone" #17, minute 1 → "1'"; minute 45 + extra 2 → "45+2'";
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
payment_reference, status }`.

### Portal (orders and tickets) — `profileService` in `src/services/auth.ts`
| Method & path | Notes |
| ------------- | ----- |
| `GET /portal/matches?filter=all\|upcoming\|past` | Paginated `{ data, meta.total }`; validated (`isPortalMatch`) |
| `GET /portal/tickets?match_id=` | Validated (`isPortalTicket`, requires `qr_image` string) |
| `GET /portal/tickets/{ticket_code}` | Detail merge when a listed ticket lacks `qr_image` |
| `GET /portal/orders/{orderNumber}` | Payment details; `ORD-` prefix stripped by the caller |
| `GET /portal/orders/{orderId}/pdf` | Binary; `Accept: application/pdf,…` |
| `GET /portal/orders` | Defined, **not called** by any screen |

### Other
| Method & path | Owner | Notes |
| ------------- | ----- | ----- |
| `POST /devices` | `registerAnonymousDevice` / `registerAuthenticatedDevice` | `{ token, platform: "android" \| "ios" }` |
| `GET /ads?placement=app_banner` | `adsService` | Items filtered field-by-field; invalid items dropped |
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
  5-min cache unless forced). A drafted seat is sent only if it is in the
  current successful seat response, still `available`, and not already in the
  cart. The cache can age, so the backend add remains the final authority.
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
navigator is replaced by `UnderConstruction503`. There is no retry or reset path
in code.

---

## 12. Error handling

- `userFacingError(error, fallback)` (`src/lib/userFacingError.ts`): transport
  errors → their fixed message; `ApiError` → backend `message` / `error` / first
  validation error; anything else → the caller's fallback.
- `backendProvidedError` additionally falls back to `ApiError.message`.
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
| User-scoped cache generation | `src/lib/userScopedCache.ts` | Tickets list/detail and PDF results after identity change |
| Request authority | `src/lib/requestAuthority.ts` | Match detail, seats, tickets, capture context |
| Cart session tickets | `src/lib/cartSessionAuthority.ts` | All cart mutations and payment completion |
| Cart refresh guard | `src/lib/cartRefreshPolicy.ts` | Out-of-order refresh responses |
| Checkout submission authority | `src/lib/checkoutSubmissionAuthority.ts` | BLUE submit result vs unmount/session change |
| Single-flight | `createSingleFlight` (`src/lib/cartSessionRecovery.ts`) | Concurrent `addItem` |
| Cart publication result | `src/lib/cartPublication.ts` (returned by `CartContext`) | Treating a resolved cart mutation as confirmed success |
| Auth submission guard | `src/lib/authSubmissionGuard.ts` | Double-submitted auth forms |
| Identity-keyed remounts | `CartProvider key`, `withAuthRequired key` | All screen and cart state on account switch |

New API-backed features must use the existing mechanism for their domain rather
than adding a parallel one.

---

## 14. Contracts not established by this repository

- Authoritative request/response schemas for any endpoint (no OpenAPI or shared
  types in the repo; types in `src/types.ts` are client-side expectations).
- Whether `/checkout/mobile/submit` returns non-2xx for declined or failed card
  payments.
- Server-side idempotency of `/checkout/mobile/submit` for a repeated session.
- Backend behavior on BLUE callback, and how web BLUE results are finalized.
- The meaning of the `password` header and of `remember` on login.
- Ticket `status` value set; whether "used" is `status` or `checked_in_at`.
- **Competitions (confirmed by the user, not yet integrated; no service calls
  them yet).** Public endpoints and their confirmed response shapes — do not
  assume other fields:
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
  - `/competitions` is currently only a navigation shell in the app.
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
