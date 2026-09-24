# Architecture — LFA User App

Current production architecture, established from source inspection.
Sections marked **Unknown / unresolved** could not be proven from the repository.
Nothing here describes a desired future architecture unless it is explicitly
labeled *Future design direction*.

Related: `docs/API_INTEGRATION.md` (requests and contracts), `docs/SECURITY.md`
(security invariants), `docs/STATUS.md` (volatile state).

---

## 1. Runtime and tooling

| Concern      | Current value (from `package.json`, `app.json`, `tsconfig.json`) |
| ------------ | ---------------------------------------------------------------- |
| Framework    | Expo SDK 57, React Native 0.86, React 19.2                        |
| Language     | TypeScript 6, `strict: true`, path alias `@/*` → `src/*`          |
| Routing      | Expo Router, `src/app`, `experiments.typedRoutes: true`           |
| Compiler     | `experiments.reactCompiler: true`                                 |
| Platforms    | iOS, Android (`com.lfaticketing.app`), web (`web.output: "server"`) |
| URL scheme   | `lfa-app`                                                         |
| Orientation  | `default` (portrait and landscape allowed)                        |
| Push         | `@react-native-firebase/messaging` (FCM tokens) + `expo-notifications` |
| Animation    | `react-native-reanimated` 4, RN `Animated`, `react-native-gesture-handler` |
| Build        | EAS (`eas.json` profiles: development, preview, production, apk)  |
| Native dirs  | `/ios`, `/android` are generated (gitignored); config via plugins |

Platform-specific modules use suffixes (`.native.ts(x)`, `.web.ts(x)`), declared
in `tsconfig.json` `moduleSuffixes` and in the ESLint resolver.

`app.config.js` wraps `app.json`: it rejects production builds whose BLUE
origin is not the configured HTTPS provider origin, and adds an iOS ATS
exception for the staging BLUE host only for staging profiles.

Tests: 47 `*.test.mjs` files run with `node --test` (Node type stripping imports
`.ts` directly). Many are source-assertion tests that regex over `.tsx`/`.ts`
source; they constrain redesign edits. There is no `npm test` script.

---

## 2. Provider tree (`src/app/_layout.tsx`)

```
GestureHandlerRootView
└─ SafeAreaProvider
   └─ ThemeProvider                 (src/components/ui.tsx)
      └─ AuthProvider               (src/context/AuthContext.tsx)
         └─ AppProviders            — renders null until auth.isReady
            ├─ ToastProvider
            ├─ AlertDialogProvider
            └─ CartProvider key={userCacheKey | "authenticated" | "guest"}
               └─ TicketHoldersProvider
                  └─ CartSheetProvider  (renders <CartSheet>)
                     └─ MaintenanceGuard
                        └─ <Stack> (all routes)
```

Invariant: `CartProvider` (and therefore `TicketHoldersProvider`) is **keyed by
the authenticated identity**, so a login, logout, or account switch remounts the
cart and holder state from scratch. Do not remove or move this key.

`AppProviders` also owns notification bootstrap: Android channel setup,
permission request, initial push registration, the FCM token-refresh
subscription, and notification-tap navigation.

---

## 3. Routes (`src/app`)

All routes are plain `Stack` screens; there is no Expo Router `Tabs` layout.

| Route | File | Auth | Notes |
| ----- | ---- | ---- | ----- |
| `/` | `index.tsx` | public | Home: `MainHeader` + `MatchesList limit={5} showAppBanner` |
| `/tournament` | `tournament.tsx` | public | Static "Coming Soon" placeholder |
| `/matches` | `matches.tsx` | public | `MatchesList filterable` |
| `/match/[id]` | `match/[id].tsx` | public view; auth to add | Zones, stadium map, GA quantities, seat selection |
| `/tickets` | `tickets.tsx` | `withAuthRequired` | Portal matches → tickets, QR, order/payment details, PDF |
| `/profile` | `profile.tsx` | `withAuthRequired` | Account hub, contact links |
| `/edit-profile` | `edit-profile.tsx` | `withAuthRequired` | Profile from `/auth/me`, avatar upload/remove, change password |
| `/settings` | `settings.tsx` | `withAuthRequired` | Theme, notification permission, account deletion |
| `/about` | `about.tsx` | `withAuthRequired` | Legal documents from API |
| `/auth` | `auth.tsx` | public | Login, register, OTP, phone completion, password recovery |
| `/cart` | `cart.tsx` | `withAuthRequired` | Full cart review (a `CartSheet` bottom sheet also exists, opened from the header) |
| `/checkout/ticket-holders` | `checkout/ticket-holders.tsx` | `withAuthRequired` | Step-by-step holder names |
| `/checkout` | `checkout.tsx` | `withAuthRequired` | Summary, payment method, submission |
| `/checkout/card/payment` | `checkout/card/payment.tsx` | `withAuthRequired` | CyberSource Unified Checkout |
| `/checkout/blue/payment` | `checkout/blue/payment.tsx` | `withAuthRequired` | BLUE WebView (native); web redirects to `/` |
| `/checkout/success`, `/checkout/failed` | `checkout/*.tsx` | `withAuthRequired` | Display-only result screens |
| `/checkout/blue/success`, `/checkout/blue/failed` | `checkout/blue/*.tsx` | `withAuthRequired` | Normalize params → redirect to generic result |
| `/api/*` | `api/[...path]+api.ts` | server | Web-only proxy to the LFA API |

**Primary navigation** is a custom bottom bar rendered by `Screen` in
`src/components/ui.tsx` when the pathname is one of `PRIMARY_TAB_ROUTES`
(`src/lib/navigationPresentation.ts`): Home, Tournament, Matches, My Tickets,
Profile — labels are already visible. Tab switches use `router.replace`;
horizontal swipe on a primary screen moves to the adjacent tab
(`Gesture.Pan` in `Screen`).

**Auth gating** is per screen: `withAuthRequired` (`src/components/withAuthRequired.tsx`)
renders `Loading` until `auth.isReady`, an `AuthRequired` prompt when signed
out, and otherwise mounts the screen with `key={auth.userCacheKey}` so screen
state resets on identity change. `AuthRequired` passes a `returnTo` limited by
the allowlist in `src/lib/authReturnRoute.ts`.

---

## 4. Layering

```
src/services/*     network (apiRequest), response validation/normalization
src/lib/*          pure authorities, guards, parsers, presentation helpers (unit-tested)
src/context/*      shared state owners (React context)
src/app/*          route composition, screen-local UI state, orchestration
src/components/*   presentation + a few flow screens (payment screens)
src/types.ts       API/domain types; src/types/ads.ts
```

Screens call services directly for read-only screen data (tickets, legal,
profile) and go through contexts for shared state (auth, cart, holders).
`apiRequest` is not called from `src/app` or `src/components`.

---

## 5. State ownership

| Domain | Owner | Persistence |
| ------ | ----- | ----------- |
| Auth token | `src/services/api.ts` (generation authority) over `authTokenStorage` | Native: SecureStore (`lfa_portal_token`), migrating from AsyncStorage; web: `localStorage` |
| Current user | `AuthContext` (`user`, `userCacheKey`, `isAuthenticated`, `isReady`) | `lfa_portal_user` in AsyncStorage / `localStorage` |
| User-scoped caches | `src/lib/userScopedCache.ts` (`clearUserScopedCaches`, generation) | memory |
| Cart / reservation | `CartContext` + `cartSessionAuthority` | `lfa_cart_session_id` = `{version, sessionId, expiresAt}` |
| Ticket-holder names | `TicketHoldersContext` (slots derived from cart items) | memory only |
| Cart sheet visibility | `CartSheetContext` | memory |
| Checkout submission / capture context | `src/app/checkout.tsx` local state + `createCheckoutSubmissionAuthority` + `createRequestAuthority` | memory |
| BLUE handoff and pending attempt | `src/lib/bluePaymentHandoff.ts` (module singletons) | memory |
| Card handoff | `src/lib/cardPaymentHandoff.ts` (module singleton) | memory |
| Maintenance flag | `src/services/api.ts` (`activateMaintenance`, `useSyncExternalStore` in `MaintenanceGuard`) | memory |
| Theme mode | `ThemeProvider` (`system`/`light`/`dark`) | `lfa_theme` |
| Match list/detail/seat data | `src/services/matches.ts` module cache (5-min TTL) | memory |
| Toasts / dialogs | `ToastContext`, `AlertDialogContext` | memory |

Not used by any route (do not assume they own anything):
`src/context/CardPaymentPreparationContext.tsx`, `src/components/ProfileDetailModal.tsx`,
`src/lib/bluePaymentDiagnostics.ts` (marked temporary), and
`getExpoPushToken` / `getDevicePushToken` in `src/lib/notifications.ts`.

---

## 6. Authentication and session

- **Generation authority** (`src/lib/authSessionOwnership.ts`, used in
  `src/services/api.ts`): every token replacement increments a generation;
  async work captures a snapshot (`captureAuthenticationSnapshot`) and checks
  `isAuthenticationSnapshotCurrent` before publishing. Mutations to storage are
  serialized through `enqueueAuthenticationMutation`.
- **Restore** (`restoreAuthentication`): token + persisted user must both be
  present and valid; any mismatch or storage failure clears both and reports
  `invalid` / `storage-error`. A storage failure suppresses the token for the
  app lifetime.
- **Login-family flows** (`authService.login`, `register`, `verifyOtp`,
  `completePhone`) persist token and user via `saveSession`. Login can return
  `phone_required`.
- **Logout** clears state first, then storage, then fires `/auth/logout`
  best-effort with the captured token.
- **401/403** on any request (unless `skipUnauthenticatedNotify`) invalidates
  the captured generation and notifies listeners → `AuthContext` clears state,
  dismisses the stack, and routes to `/`.
- **Change password** clears the session and routes to `/auth`.
- **Account deletion** calls `DELETE /auth/account`, then clears the session.
- **No bearer-token refresh exists.** Sessions end on 401/403 or explicit logout.
- User-scoped caches are cleared whenever the identity key changes.

---

## 7. Match discovery and ticket selection

- `MatchesList` (`src/components/MatchesList.tsx`) loads
  `matchesService.list(filters)` + `matchesService.filters()`; filters are team,
  stadium, and date. The data source is **scheduled matches** only.
- `AppBanner` loads `/ads?placement=app_banner`; links are validated by
  `src/lib/adUrls.ts` (internal allowlist or external HTTPS only).
- `match/[id].tsx` loads `matchesService.details(id)` and, for reserved-seating
  zones, `matchesService.seats(matchId, zoneId)`; the stadium map is an image
  (SVG/raster from storage) with polygon overlays (`src/lib/mapGeometry.ts`).
- Zone kinds come from the backend: `zone.has_seats` → reserved seating (seat
  selection) vs general admission (quantity stepper).
- GA quantities are a **local draft** on the screen until "Add to Cart";
  `commitSelections` diffs drafts against committed cart lines and calls
  `addItem` / `updateItem` / `removeItem` sequentially (single-flight `addItem`
  would drop concurrent calls). Seat selections are filtered against seats
  already in the cart (`getEffectiveSelectedSeats`).
- Request staleness on this screen is guarded by `createRequestAuthority`
  (`src/lib/requestAuthority.ts`).

---

## 8. Cart and reservation (`src/context/CartContext.tsx`)

- The backend cart is authoritative; the client holds only the
  `checkout_session_id`, `expires_at`, and the last server response.
- **Session authority** (`src/lib/cartSessionAuthority.ts`): generation +
  session ID; every mutation captures a ticket and publishes only if still
  current. Persistence writes are serialized.
- **Operation queue** (`src/lib/cartOperationQueue.ts`): all mutations run
  serially; `isLoading` reflects pending mutations.
- **Add** merges into an existing GA line for the same zone/match via `update`;
  otherwise `add` with the session ID. A 404 on add invalidates the rejected
  session and retries once without it (`addWithSessionRecovery`).
- **Refresh**: 404 → session cleared; other failures keep the session and set
  `cartRefreshError`. An empty cart clears the session.
- **Expiry**: a 1-second tick computes `secondsLeft`; at zero, or when the app
  returns to foreground past expiry, the session is cleared and the stack is
  reset to `/`.
- Unauthenticated `addItem` routes to `/auth`. Signed-out mount removes any
  persisted session ID.
- Consumers use `captureCartSession`, `isCartSessionCurrent`, and
  `clearCartIfSession(ticket)` — never an unconditional clear — in payment flows.

---

## 9. Ticket holders

`TicketHoldersContext` derives one slot per physical ticket from cart items
(`deriveTicketSlots`: `${lock_key}_seat_${id}` / `${lock_key}_ticket_${i}`).
`/checkout/ticket-holders` collects names (first slot pre-filled from the
profile name once). `/checkout` redirects back there if any slot lacks a name.
Names are sent as `tickets_by_match` at submission.
`resetHolderNames` exists but is not called; names reset only when
`CartProvider` remounts.

---

## 10. Checkout and payment

**Checkout (`src/app/checkout.tsx`)** — owns payment-method selection,
capture-context loading for CyberSource, and BLUE submission. Billing comes
from the authenticated profile (name, email, canonical phone, country `LB`); a
valid phone is required. `refreshUser()` runs on focus. Duplicate submission
is blocked by `submitInFlightRef` + `checkoutSubmissionAuthority`, and results
are ignored if the cart session changed.

**CyberSource (card)**
1. Selecting "Card" requests a capture context
   (`POST /payments/cybersource/capture-context`) keyed to the cart session.
2. "Continue" creates a card handoff and navigates to `/checkout/card/payment`.
3. `CybersourceUnifiedCheckout` mounts Unified Checkout (native: WebView with
   inline HTML loading the configured SDK script; web: script tag +
   `src/lib/cybersourceWebLifecycle.ts`) and yields a transient token.
4. `CardPaymentScreen` submits `POST /checkout/mobile/submit` with
   `payment.transient_token`. Only a successful response for the still-current
   cart session clears the cart (`clearCartIfSession`) and routes to
   `/checkout/success`.

**BLUE (wallet)**
1. `submitBlue` posts `/checkout/mobile/submit` with `payment_method: "blue"`,
   validates `payment.payment_url` against the configured BLUE origin and a
   `/payment/<id>` path (`validateBluePaymentUrl`), and stores a pending
   attempt for the session (reused on retry instead of resubmitting).
2. Native: navigates to `/checkout/blue/payment`, which loads the URL in a
   WebView. Every navigation passes through `decideBlueNavigation`
   (`src/lib/bluePaymentRedirect.ts`).
3. A terminal success URL (configured redirect origin `/payment/success` or
   `lfa-app://checkout/success?provider=blue`) clears the cart for the
   matching session and routes to `/checkout/success`. A failure URL returns
   to `/checkout` with the reservation intact.
4. Web: `window.location.assign(paymentUrl)`; the in-app BLUE route redirects to `/`.

**Result screens** (`CheckoutPaymentResult`) are display-only. Route params
are sanitized by `src/lib/checkoutResultParams.ts`; they do not mutate cart or
order state.

---

## 11. Tickets, orders, QR, PDF (`src/app/tickets.tsx`)

- List: `profileService.matches(filter)` with filter `all | upcoming | past`
  (`GET /portal/matches`), validated by `isPortalMatch`.
- Detail: `profileService.tickets(matchId)`; tickets lacking `qr_image` are
  enriched via `profileService.ticket(code)`.
- **QR**: rendered only from backend `qr_image` values that start with
  `data:image/`; otherwise "QR unavailable". The client never generates QR codes.
- Ticket status is the backend `status` string (styling currently keys off
  `valid` / `expired`); `checked_in_at` is also present in the type.
- Payment details: `profileService.order(orderNumber)` on demand, cached in
  screen state.
- PDF: `downloadProfileOrderPdf` → `profileService.orderPdf` (binary fetch) →
  native: write to cache dir and open the share sheet; web: Blob download.
- Staleness: `createRequestAuthority` per list/detail plus the user-scoped cache
  generation.

---

## 12. Push notifications and device registration

- `src/lib/notifications.ts`: permission helpers, Android channel, FCM token
  (`getFcmDeviceToken`), and `subscribeToFcmTokenRefresh`.
- `src/lib/registerPushDevice.ts`: decides anonymous vs authenticated
  registration at send time; the authenticated request lets `apiRequest`
  resolve the live token.
- Registration triggers: app start (after permission), every change to an
  authenticated token (`AuthContext`), and every FCM token refresh.
- Notification taps with a `match_id` push `/match/[id]`
  (`src/lib/notificationNavigation.ts`). No other payload routing exists.
- Native only; web skips registration.

---

## 13. Maintenance

Any HTTP 503 (from `apiRequest` or the PDF fetch) calls `activateMaintenance()`;
`MaintenanceGuard` then replaces the entire navigator with
`UnderConstruction503`. The flag is never reset in code and the screen has no
retry, so recovery requires an app restart.

---

## 14. Theming, responsive, accessibility

- Palettes: `src/lib/themePalette.ts` (`lightColors`, `darkColors`; brand red
  primary). Shared text/surface styles: `createStyles` in `src/components/ui.tsx`.
  There are no spacing, radius, or typography token scales yet — values are
  inline per component.
- Responsive: `useResponsive()` → `isNarrow` (<390), `isTablet` (≥768),
  `isDesktop` (≥1024), `contentWidth` (≤1180). Safe-area insets are applied in
  `Screen`, headers, and payment screens.
- Reduced motion: `useReducedMotion()` gates the tab entrance animation and
  other decorative motion.
- Accessibility: roles/labels/states on controls, `announceForAccessibility`
  on payment results, accessible seat and filter helpers
  (`src/lib/seatAccessibility.ts`, `src/lib/matchFilterAccessibility.ts`),
  enforced partly by source tests.

---

## 15. Localization and RTL

**Unknown / not implemented.** No i18n library, no string catalog, no
`I18nManager`, no Arabic. All copy is inline English. Dates/money use `Intl`
helpers in `src/lib/format.ts`. The CyberSource capture context requests
`locale: "en-us"`. Country names come from `i18n-iso-countries` English data.

---

## 16. Invariants redesign work must preserve

1. `CartProvider` keyed by identity; `withAuthRequired` keys screens by `userCacheKey`.
2. Backend JSON/API calls go through services and `apiRequest`; the only direct transports are the PDF fetch, the match-screen SVG map fetch, and the web proxy (`AGENTS.md` §7).
3. Auth-generation and cart-session-ticket checks before publishing async results.
4. Cart cleared only via `clearCartIfSession` after a trusted terminal result for the same session.
5. BLUE URL validation and `decideBlueNavigation` stay in the path of every WebView navigation.
6. Holder-name completeness gates checkout submission.
7. QR comes only from backend `qr_image` data URIs.
8. Duplicate-submission guards on checkout and auth forms remain.
9. 503 → maintenance, 401/403 → session invalidation remain centralized in `apiRequest`.
10. Platform splits (`.native` / `.web`) keep equivalent ownership on each platform.

---

## 17. Unknown / unresolved

- Whether the backend returns non-2xx for declined card payments (the client
  treats any 2xx submit response as success).
- How BLUE results are finalized on **web** (the in-app route is native-only).
- Whether "live" or "result/score" data exists in any API (discovery uses
  scheduled matches only).
- Full set of backend ticket `status` values and whether "used" is represented
  by `status` or only `checked_in_at`.
- What the `remember` flag changes server-side (the client always persists the token).
- Whether any backend endpoint supports editing name/phone (none is called).

---

## 18. Future design direction (not current architecture)

Planned by the redesign roadmap (`docs/WORKFLOW.md` §4), subject to per-phase
approval: semantic spacing/radius/typography tokens alongside the existing
palette, shared state panels and skeletons, a sticky transaction bar, a
ticket-card foundation, and a localization/RTL layer. None of these exist yet.
