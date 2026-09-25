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

Tests: `*.test.mjs` files run with `node --test` (Node type stripping imports
`.ts` directly; current totals are in `docs/STATUS.md`). Pure modules they
import must not use runtime relative imports (Node cannot resolve
extensionless paths); inject dependencies instead, as `createTranslator` does. Many are source-assertion tests that regex over `.tsx`/`.ts`
source; they constrain redesign edits. There is no `npm test` script.

---

## 2. Provider tree (`src/app/_layout.tsx`)

```
GestureHandlerRootView
└─ SafeAreaProvider
   └─ I18nProvider                  (src/i18n/I18nProvider.tsx) — renders nothing
      │                              until locale + native direction are ready (§15)
      └─ ThemeProvider              (src/components/ui.tsx)
         └─ AuthProvider            (src/context/AuthContext.tsx)
            └─ AppProviders         — renders null until auth.isReady && i18n.isReady
            ├─ ToastProvider
            ├─ AlertDialogProvider
            └─ CartProvider key={userCacheKey | "authenticated" | "guest"}
               └─ TicketHoldersProvider
                  └─ CartSheetProvider  (renders <CartSheet>)
                     └─ MaintenanceGuard
                        └─ <Stack> (all routes)
```

Because `I18nProvider` withholds its children until ready, auth restore and the
cart start only after the app language and layout direction are settled.

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
| `/` | `index.tsx` | public | Home: `MainHeader` + `HomeFeed` (banner, featured match, upcoming) |
| `/tournament` | `tournament.tsx` | public | Static "Coming Soon" placeholder |
| `/matches` | `matches.tsx` | public | `MainHeader` + `MatchesList` (filters, full scheduled list) |
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
Profile.
- **Presentation** (owned by `Screen` / `BottomNavigation`): each tab shows its
  icon and a visible catalog label. The selected tab gets an indicator pill,
  heavier weight and brand colour. Semantics are `tablist` / `tab` with
  `aria-selected`.
- **Switching** is owned by `navigateToTab` in `Screen`: `router.replace`, no
  push, and a tap on the active tab is ignored.
- **Swipe:** a horizontal swipe on a primary screen moves to the adjacent tab
  (`Gesture.Pan` in `Screen`).
- **RTL:** swipe direction and the entrance offset follow reading direction
  (`swipeTabStep`, `tabEntranceOffset` in `navigationPresentation.ts`). Reduced
  motion skips the entrance.

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
| App language | `I18nProvider` (resolved against `ENABLED_LOCALES`) | `lfa_locale` |
| Direction-transition marker | `I18nProvider` + `src/i18n/directionTransition.ts` | `lfa_direction_transition` = `{desired, attempts}` |
| Format locale | `src/lib/format.ts` (`setFormatLocale`, set by `I18nProvider`) | memory |
| Match list/detail/seat data | `src/services/matches.ts` module cache (5-min TTL) | memory |
| Scheduled-match screen state (Home, Matches) | `useScheduledMatches`, one instance per screen (filter-tagged snapshot, loading, refresh, retry) | memory |
| Match filter values | `MatchesList` (composition-level `useState`) | memory |
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

### Scheduled-match discovery (Home and Matches)

- **`matchesService`** (`src/services/matches.ts`) still owns the backend
  contract (`/matches/scheduled`, `/matches/scheduled/filters`) and its
  module-level 5-minute cache. The data source is **scheduled matches** only.
- **`useScheduledMatches`** (`src/hooks/useScheduledMatches.ts`) is the
  screen-level owner:
  - initial load, pull-to-refresh (`force`) and retry;
  - request authority (`createRequestAuthority`), plus a synchronous
    `invalidate(nextFilters)`;
  - loading and error state;
  - a snapshot that tags successful results and errors with the filter
    identity that produced them (`src/lib/matchQuery.ts`).

  Home and Matches each use their own hook instance; they share only the
  service cache.
- **Query/result integrity (invariant):**
  - a stale request can never publish under a newer filter selection;
  - displayed results always belong to the currently selected filters;
  - a failed refresh of the *same* filters keeps the earlier results and shows
    Retry;
  - a failed *changed*-filter request shows the new filters' error and never
    presents old results as if they belonged to the new filters;
  - a selection with neither results nor an error counts as loading.
- **Kickoff parsing** (`matchKickoffTime` in `src/lib/matchDiscovery.ts`):
  - valid only for a real calendar `match_date` plus an in-range clock time
    (or a well-formed ISO datetime);
  - anything missing or malformed is *unknown*, never fabricated as midnight;
  - unknown kickoffs sort last and can never be featured or upcoming;
  - times are read as local wall-clock time, because the backend timezone
    contract is unresolved (`docs/API_INTEGRATION.md` §14).
- **Home** (`src/components/HomeFeed.tsx`):
  - ads banner, then the featured-match hero, then an "Upcoming matches"
    section with "All matches" (tab-replace to `/matches`);
  - the featured match is **presentation-derived**, not backend metadata: the
    earliest valid kickoff not yet passed (`selectHomeMatches`);
  - Upcoming holds only further valid, not-yet-passed kickoffs, so Home shows
    the featured match plus up to 4 more (5 total). Past and unknown-time
    fixtures appear only on the Matches screen;
  - the presentation time comes from `useKickoffClock`: the load time,
    advanced by one timer at the next valid kickoff and on app foreground. No
    polling and no network request; it re-selects from loaded data;
  - states: skeletons, error with Retry, "No scheduled matches", and "No
    upcoming matches" (with a link to Matches).
- **Matches** (`src/components/MatchesList.tsx`):
  - filter values (team, stadium, date) are composition-level state and map
    to the existing backend parameters;
  - every change goes through `changeFilters`, which calls `invalidate`
    before setting state;
  - UI: a filter bar (Filters button with active count, removable chips,
    Clear) and a filter sheet (`BottomSheetModal`) with radio-style
    team/venue options and an inline calendar;
  - filters apply immediately, and "Done" only closes the sheet;
  - states: skeletons, error with Retry, global empty vs filtered empty (with
    Clear), and results sorted by kickoff;
  - opening a card still pushes `/match/[id]`.
- **Match presentation** (`src/components/match/*`: `MatchCard`,
  `FeaturedMatchCard`, `TeamCrest`, `matchLabels`, the skeletons, and the
  filter bar/sheet):
  - they render team names and logos (with an initials fallback), date and
    kickoff, stadium, a status (only a backend `scheduled` shows as Scheduled;
    blank is neutral "Status unavailable"; others use the backend's own word),
    and one accessible description per card;
  - they must not fetch, route except through a passed `onPress`, own filter
    state, infer cart or checkout state, or fabricate match states (live,
    results, sold out…).

### Match detail and ticket selection

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

- **Colors** — `src/lib/themePalette.ts` (`lightColors`, `darkColors`):
  - legacy roles (`bg`, `panel`, `ink`, `muted`, `primary`…) kept for
    not-yet-redesigned screens;
  - semantic roles (`background`, `surface`, `textStrong`, `textMuted`,
    `action*`/`on*`, `disabled*`, `selectedSurface`, `focusRing`, `hero`,
    `skeleton*`, `scrim`, `scanSurface`) and 8 status `tones`
    (neutral, brand, success, warning, danger, info, live, unavailable).
  - Semantic text and tone pairs meet WCAG AA in both themes
    (`src/lib/themeContrast.test.mjs`). The legacy `muted` does not.
  - Tones are presentation vocabulary; mapping a backend status to a tone
    belongs to the screen that owns the data.
- **Scales** — `src/lib/designTokens.ts` (pure, theme-independent): `spacing`,
  `radius`, `size` (touch target 48 / 44 minimum, control height 48),
  `breakpoints` (mirroring `useResponsive`), `layout`/`pageGutter`, and
  `typography` (12 variants; system fonts; letter-spacing never used because
  it breaks Arabic joining; tabular digits for prices and totals).
- **Shared primitives** (`src/components/ui.tsx`): `Screen`, `Card`, `Button`,
  `Input`, `Empty`, `Loading`, `BottomNavigation` (see accessibility below).
  `createStyles` still carries legacy per-screen styles.
- **Foundation components** (`src/components/foundation/`; they import from
  `ui.tsx`, never the reverse):
  - `AppText` — typography variant and tone, natural alignment.
  - `SectionHeader`.
  - `StatusBadge` — tone-driven; never interprets statuses.
  - `StatePanel` — empty/error/unavailable/info with optional actions; never
    fetches.
  - `Skeleton*` — reduced-motion aware.
  - `TransactionBar` — presentation-only total and primary action; receives
    values and callbacks from the existing owner and holds no transaction state.
  - Ticket primitives (`TicketCardShell`, `TicketCardSection`,
    `TicketPerforation`, `TicketQrFrame`) — layout only; no QR generation.
  - `PhysicalLayout`, `DirectionalChevron`.
  - Consumers so far: `tournament.tsx` (`StatePanel`); Home, Matches and
    `src/components/match/*` (`AppText`, `StatusBadge`, `SectionHeader`,
    `StatePanel`, skeletons, `DirectionalChevron`). `TransactionBar` and the
    ticket primitives are ready for Phases 3–5.
- Responsive: `useResponsive()` → `isNarrow` (<390), `isTablet` (≥768),
  `isDesktop` (≥1024), `contentWidth` (≤1180). Safe-area insets are applied in
  `Screen`, headers, and payment screens.
- Reduced motion: `useReducedMotion()` gates the tab entrance animation and
  other decorative motion.
- Accessibility strengths: accessible seat and filter labels/states
  (`src/lib/seatAccessibility.ts`, `src/lib/matchFilterAccessibility.ts`,
  `MatchesList`), `announceForAccessibility` on payment results, a live region
  on the maintenance screen, reduced-motion gating, and responsive/safe-area
  infrastructure — enforced partly by source tests.
- **Shared primitives (corrected in Phase 1):**
  - `Button`: button role, label defaulting to the title, `aria-disabled` /
    `aria-busy`, optional `loading`, 48pt height, readable disabled text.
  - `Input`: the visible label names the field (`accessibilityLabel` and
    `accessibilityLabelledBy`); callers can override it.
  - `Loading`: a single labelled progress element with `aria-busy`.
  - Bottom navigation: `tablist`/`tab` with `aria-selected`; labels come from
    the catalog and are rendered visibly (Phase 2).
  - `StatePanel`: one polite live region for errors, and no nested `alert` role.
- **State props:** react-native-web ignores the `accessibilityState` object, so
  shared primitives use `aria-*` props (`aria-selected`, `aria-disabled`,
  `aria-busy`), which React Native also supports natively.
- **Remaining legacy concerns:**
  - Existing screens that use `accessibilityState` (e.g. ticket filters,
    `MatchesList`) do not expose that state on web.
  - Older screens still use the legacy `muted` color.
  - Both are migrated as each screen is redesigned.

---

## 15. Localization and RTL

An English-only foundation exists (Phase 1). **Arabic UI is not translated or
enabled.** No third-party i18n library is used.

- **Locale ownership** — `src/i18n/locales.ts`:
  - `AppLocale` is `en | ar`, with `LOCALE_META` holding the tag, direction,
    script and native name.
  - `ENABLED_LOCALES = ["en"]`. The app language is an app setting stored in
    `lfa_locale`, never inferred from the device. Unknown or disabled values
    resolve to `en`.
- **Catalog** — `src/i18n/messages/en.ts`:
  - flat keys (`area.purpose`), `{name}` interpolation, and plural families
    (`.one`/`.other`, and other CLDR categories where a language needs them);
  - only foundation, navigation, Tournament and direction-restart strings so
    far; other screens still hold inline English and move to the catalog as
    they are redesigned.
- **Translator** — `src/i18n/translate.ts`, pure:
  - lookup falls back from locale → English → the key itself;
  - the explicit plural `count` is authoritative, and a conflicting
    `params.count` is rejected by type and ignored at runtime.
- **Plural rules** — `src/i18n/pluralRules.ts`:
  - internal CLDR cardinal rules for `en` (one/other) and `ar`
    (zero/one/two/few/many/other), checked against full ICU in tests;
  - the translator receives the selector from `pluralSelectorFor(tag)`;
  - an unsupported language throws a clear error.
  - **Native startup never depends on `Intl.PluralRules`**, because Hermes does
    not provide it; constructing it crashed native startup during Phase 1.
- **Direction lifecycle** — `src/i18n/directionTransition.ts` (pure) plus
  `I18nProvider`:
  - The desired direction comes from the app language; the active direction is
    `I18nManager.isRTL`, fixed per runtime.
  - Match → ready. Mismatch → set `allowRTL`/`forceRTL`, persist
    `lfa_direction_transition`, then reload once with `reloadAppAsync`
    (shipped in `expo`).
  - A mismatch that survives the reload, a no-op reload (4 s timeout), or an
    unreadable or unwritable marker produces a blocking "Restart required"
    screen with a manual restart button.
  - At most one automatic reload per desired direction, so no loop is possible.
  - Web sets `document.documentElement.dir`/`lang` and is ready immediately.
- **RTL conventions** — `src/i18n/direction.ts`: logical start/end props,
  natural text alignment, and mirrored directional chevrons only.
  `PHYSICAL_LAYOUT_STYLE` / `<PhysicalLayout>` pins real-world geometry to LTR:
  the stadium map and seat map in `match/[id].tsx`, and `TicketQrFrame`.
- **Formatters** — `src/lib/format.ts` (presentation only):
  - date, time and money follow the app locale (`setFormatLocale`), not the
    device's;
  - `formatMoney` shows two decimals with locale grouping plus the backend
    currency code, and returns `MONEY_UNAVAILABLE` ("Price unavailable") for
    missing or non-finite values, never a fake `0.00`;
  - `Intl.NumberFormat` is capability-checked, with a `toFixed(2)` fallback;
  - formatters never alter the values that callers or transactions use.
- **Other locale touchpoints:** the CyberSource capture context still requests
  `locale: "en-us"`, and phone country names use `i18n-iso-countries` English
  data. The browser entry (`i18n-iso-countries/index.js`) is imported on
  purpose: the package Node entry loads every locale through a dynamic require
  that Metro cannot bundle, which broke web server rendering.

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
11. App content renders only when `I18nProvider` is ready, i.e. when the active native direction equals the app language's.
12. Stadium maps, seat maps and QR codes never mirror (`PHYSICAL_LAYOUT_STYLE`).
13. Startup code never constructs an `Intl` API without a capability check (Hermes lacks some, e.g. `PluralRules`).
14. Scheduled-match loading goes through `useScheduledMatches` over `matchesService`; filter changes invalidate synchronously, and results are shown only under the filters that produced them.
15. Unknown or invalid kickoffs are never fabricated into a time, featured, or listed as upcoming.

---

## 17. Unknown / unresolved

- Whether the backend returns non-2xx for declined card payments (the client
  treats any 2xx submit response as success).
- How BLUE results are finalized on **web** (the in-app route is native-only).
- Whether "live" or "result/score" data exists in any API (discovery uses
  scheduled matches only).
- The timezone of `match_date` + clock-only `kickoff_at` (read as local
  wall-clock time; see `docs/API_INTEGRATION.md` §14).
- Full set of backend ticket `status` values and whether "used" is represented
  by `status` or only `checked_in_at`.
- What the `remember` flag changes server-side (the client always persists the token).
- Whether any backend endpoint supports editing name/phone (none is called).

---

## 18. Future design direction (not current architecture)

The Phase 1 foundations described in §14–§15 now exist. Still planned, per the
roadmap (`docs/WORKFLOW.md` §4) and subject to per-phase approval:
- screen redesigns that consume these foundations (Phases 2–6);
- an Arabic catalog and enabling `ar` (plus the Arabic numerals decision);
- RTL-aware tab swipe and entrance motion;
- migrating legacy colors and `accessibilityState` usage.
