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
                     ├─ ReservationExpiryNotice  (observes expiry; renders nothing)
                     └─ MaintenanceGuard
                        └─ AppChrome        (src/components/AppChrome.tsx)
                           ├─ ReservationHoldBar  (global reservation indicator, §8)
                           ├─ <Stack> (all routes)
                           └─ OnboardingFlow      (first-run overlay, §2.1)
```

Because `I18nProvider` withholds its children until ready, auth restore and the
cart start only after the app language and layout direction are settled.

Invariant: `CartProvider` (and therefore `TicketHoldersProvider`) is **keyed by
the authenticated identity**, so a login, logout, or account switch remounts the
cart and holder state from scratch. Do not remove or move this key.

`AppProviders` also owns notification bootstrap: Android channel setup,
initial push registration **only when permission is already granted** (it
never prompts), the FCM token-refresh subscription, and notification-tap
navigation. It reaches `expo-notifications` only through
`src/lib/notifications.ts` (§12).

`AppProviders` additionally waits for the custom fonts to settle
(`useAppFonts`, §14) before rendering, and keeps the native splash up until
the onboarding gate has decided (§2.1).

### 2.1 First-run onboarding

- **Owner:** `useOnboardingGate` (`src/hooks/useOnboardingGate.ts`) over the
  pure rules in `src/lib/onboarding.ts`; UI in
  `src/components/onboarding/OnboardingFlow.tsx`.
- **Flow:** splash → three product pages → notification pre-prompt → app. No
  favourite-team step (no backend contract).
- **Persistence:** `lfa_onboarding_v1` = `"completed"`. Written on finish, and
  for a signed-in (existing) user at startup so they are never sent through it.
- **Offered only when:** native platform, flag absent, not signed in, and the
  **resolved** initial destination is Home. The decision
  (`decideLaunchOnboarding`) never uses the early pathname, which reads `/`
  on an Android cold start before the initial link resolves. It waits for
  the navigation container's `ready` event (`useNavigationContainerRef`,
  read-only) and reads the focused route from it. It also resolves the
  launch notification (`notificationMatchId`, the same rule the tap router
  uses); a notification that opens a match is a direct entry. Any direct
  entry (deep link, auth return, payment result, notification tap) skips it
  for that launch, with no overlay at any point. The native splash stays up
  while this resolves (released anyway if maintenance replaces the
  navigator). While visible, any navigation away from `/` makes it step
  aside without being marked completed.
- **No navigation or data:** it overlays Home (the app beneath is hidden from
  assistive tech) and never routes, fetches or touches the cart.
- **Notifications:** the pre-prompt is offered only while the OS can still ask
  (`undetermined`, push runtime present). "Turn on notifications" calls
  `optInToPushNotifications` (native prompt, then the same registration);
  "Not now" continues without prompting.

---

## 3. Routes (`src/app`)

All routes are plain `Stack` screens; there is no Expo Router `Tabs` layout.

| Route | File | Auth | Notes |
| ----- | ---- | ---- | ----- |
| `/` | `index.tsx` | public | Home: `HomeFeed` (brand header, featured match, ads banner, My Tickets shortcut, upcoming) |
| `/matches` | `matches.tsx` | public | `MatchesList` (tab header, date strip, filters, date-grouped scheduled list) |
| `/competitions` | `competitions.tsx` | public | Navigation shell (honest "on the way" state); full screen in a later batch |
| `/tournament` | `tournament.tsx` | public | Legacy route: `<Redirect href="/competitions" />` (kept for old links/allowlists) |
| `/match/[id]` | `match/[id].tsx` | public view; auth to add | Match hero, zones, stadium map, GA quantities, seat selection, one confirmation action |
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
(`src/lib/navigationPresentation.ts`): Home, Matches, My Tickets,
Competitions, Profile (the v3 order). `/tournament` is not a tab; it redirects
to `/competitions`, and both stay in the auth-return and ad-link allowlists.
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
| Cart re-read ("reconciliation") gate, shared by every cart and payment surface | `CartContext` over `src/lib/cartReconciliation.ts` | memory |
| Payment gate per cart session: the one in-progress attempt, and the unknown-outcome lock | `src/lib/paymentOutcomeLock.ts` (storage injected by `CartContext`) | `lfa_payment_outcome_lock` = `{version, sessionId, method}` |
| Cart-line busy state (Cart screen, cart sheet) | `useCartLineActions` — busy line only, never cart data | memory |
| Ticket-holder names | `TicketHoldersContext` (slots derived from cart items) | memory only |
| Cart sheet visibility | `CartSheetContext` | memory |
| Checkout submission / capture context | `src/app/checkout.tsx` local state + `createCheckoutSubmissionAuthority` + `createRequestAuthority` | memory |
| BLUE handoff and pending attempt | `src/lib/bluePaymentHandoff.ts` (module singletons) | memory |
| Card handoff | `src/lib/cardPaymentHandoff.ts` (module singleton) | memory |
| Maintenance flag | `src/services/api.ts` (`activateMaintenance`, `useSyncExternalStore` in `MaintenanceGuard`) | memory |
| Theme mode | `ThemeProvider` (`system`/`light`/`dark`) | `lfa_theme` |
| First-run onboarding seen | `useOnboardingGate` over `src/lib/onboarding.ts` | `lfa_onboarding_v1` |
| Custom fonts registered | `useAppFonts` → `setCustomFontsLoaded` (`src/lib/fontFamilies.ts`) | memory |
| Global reservation indicator | derived in `AppChrome` from `CartContext` (`src/lib/reservationIndicator.ts`); holds no state | — |
| App language | `I18nProvider` (resolved against `ENABLED_LOCALES`) | `lfa_locale` |
| Direction-transition marker | `I18nProvider` + `src/i18n/directionTransition.ts` | `lfa_direction_transition` = `{desired, attempts}` |
| Format locale | `src/lib/format.ts` (`setFormatLocale`, set by `I18nProvider`) | memory |
| Match list/detail/seat data | `src/services/matches.ts` module cache (5-min TTL) | memory |
| Scheduled-match screen state (Home, Matches) | `useScheduledMatches`, one instance per screen (filter-tagged snapshot, loading, refresh, retry) | memory |
| Match filter values | `MatchesList` (composition-level `useState`) | memory |
| Ticket-selection drafts (GA quantities, reserved-seat picks) | `src/app/match/[id].tsx` local state — transient, never a cart authority | memory only |
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
- **Home** (`src/components/HomeFeed.tsx`, LFA Screen v3):
  - brand header (initials avatar → Profile tab), the featured-match hero,
    the ads banner, the My Tickets card, Live now, Latest result, then
    "Upcoming" with "See all" (tab-replace to `/matches`);
  - Live now / Latest result: `useScheduledMatches` with `status: "live"`
    / `"completed"` (same service, cache and guards); shown only when the
    backend returns such matches; backend scores only (`matchScore`), no
    minutes, events or statistics; display-only (no result screen yet);
  - My Tickets card: `useNextTicketMatch` (`profileService.matches("upcoming")`,
    request authority + user-scoped generation, signed-in only) → "{n}
    tickets for {home} v {away}"; otherwise the plain entry; always a tab
    switch;
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
- **Matches** (`src/components/MatchesList.tsx`, LFA Screen v3):
  - applied filters (team, stadium, date) and the Upcoming / Live / Results
    tab are composition-level state; `matchQueryFor` maps them to ONE
    `/matches/scheduled` query: Upcoming omits `status`, Live sends
    `status=live`, and Results sends `status=completed`. An explicitly selected
    date is preserved and sent on every tab; team, stadium and date compose
    with the supported status server-side;
  - every change goes through `changeSelection`, which calls `invalidate`
    before setting state (the status is part of the request identity);
  - UI: v3 segmented control (Live dot only when the backend reports live
    matches), date strip (Upcoming: today + 12 days; Results: the previous
    7; none on Live, though a date selected in the filter sheet is still sent
    to the backend; dots from the tab's real undated results), summary row
    (count · filter names, Clear, Filters) and the v3 filter sheet (draft;
    Date: Any / Today / Pick a date, Status, Team, Stadium; Reset; "Show
    matches" applies);
  - states: skeletons, error with Retry, global empty vs filtered empty (with
    Clear), and results sorted by kickoff and grouped under their backend
    `match_date` (`groupMatchesByDate`; undated fixtures last, never re-dated);
  - no competition filter (`/matches/scheduled` has no such parameter),
    no date ranges (it filters one day), no minutes/events;
  - opening a card still pushes `/match/[id]`.
- **Match presentation** (`src/components/match/*`: `MatchCard` (a row in a
  grouped `MatchGroup` card), `FeaturedMatchCard`, `PitchArt` (decorative),
  `TeamCrest`, `matchLabels`, the skeletons, the date strip and the filter
  bar/sheet):
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
- **Route** (`src/app/match/[id].tsx`) owns:
  - screen composition;
  - the selected zone;
  - the transient GA drafts and reserved-seat draft;
  - request coordination: `matchesService.details(id)` and, for reserved zones,
    `matchesService.seats(matchId, zoneId)`, each behind its own
    `createRequestAuthority` (`src/lib/requestAuthority.ts`);
  - the confirmation orchestration.

  It does **not** own cart or reservation state; that stays in `CartContext`
  and the backend (§8).
- **Presentation** (`src/components/match/*`) renders values and calls back.
  These components never fetch, read the cart, or hold selection state:
  - `MatchDetailHero`: the dark hero, built from the shared `matchLabels`,
    `TeamCrest` and `StatusBadge`;
  - `TicketOptions`: zone cards, the GA stepper, and the reserved-zone status;
  - `SeatSelection`: seat glyphs, the legend, zoom controls, and the selection
    summary;
  - `MatchDetailSkeleton` (in `MatchSkeletons`).
- **Pure selection rules** (`src/lib/ticketSelection.ts`). This module
  describes drafts and how they compare with the cart. It is not a
  transaction authority. It provides:
  - the GA draft-vs-cart diff, which plans add / set / remove / no-op per
    zone: no committed quantity → `addItem` with the chosen quantity; a
    changed positive quantity → `updateItem` (set, never an additive merge);
    zero → `removeItem`; unchanged → nothing;
  - cart-derived projections (`cartLinesByZone`, `cartSeatIdsForZone`);
  - the actionable-seat derivation, seat-state rules, and the seat summary;
  - display-only estimates;
  - the selection preflight, the confirmation executor
    (`executeSelectionCommit`), and error classification (catalog messages
    only, never backend wording).
- Zone kinds come from the backend: `zone.has_seats` → reserved seating (seat
  selection) vs general admission (quantity stepper).
- **One confirmation action** (a `TransactionBar`) sends GA changes and pending
  seats together. The confirmation invariant (§8) applies:
  - the preflight runs before any cart mutation;
  - the changes then run **sequentially** through `CartContext` (the
    single-flight `addItem` would drop concurrent calls): GA in zone order,
    then the seats as one `addItem`;
  - the sequence stops at the first step that throws or is not confirmed;
  - success requires the last published snapshot to belong to the owner's
    current session and to contain every intended change;
  - **the sequence is not atomic**: earlier changes can succeed before a later
    one fails;
  - drafts clear, success shows and `/cart` opens **only** on confirmed
    success;
  - otherwise drafts are kept and re-diffed against the published cart, so an
    applied change is not resent;
  - an unknown outcome (unconfirmed publication, network, timeout, server
    error) raises the shared cart re-read gate (§8) and switches the action to
    "Refresh cart"; only a confirmed `refreshCart()` of that session
    re-enables confirming;
  - a definite rejection (409/410/422/401) can be retried directly.
- **Reserved-seat validity:**
  - A drafted seat is actionable only against the **current successful seat
    snapshot**, i.e. one loaded for the current match / zone / cart request
    identity that is not loading and did not fail.
  - A seat enters the confirmation payload only if it:
    - exists in that snapshot;
    - is still available;
    - is not already in the cart.
  - Only these actionable seats are counted, priced, summarised and sent.
    Stale, vanished or unavailable seats are excluded, with a notice; the
    user's draft is kept for retry, and no replacement seats are added.
  - A loading or failed snapshot blocks confirmation. A mixed GA + seat
    selection is blocked by the preflight **before any cart mutation starts**.
  - Seat-load errors are scoped to the request identity that produced them.
  - The 5-minute seat cache can age, so the backend stays the final authority
    for races after the preflight.
- **Seat map** (physical layout, §15):
  - backend coordinates and polygons are authoritative and never mirror in
    RTL;
  - zoom (100 / 150 / 200 %) scales positions for presentation only;
  - the visible glyph stays compact (18 px × zoom);
  - each seat has an invisible press target, centred on the glyph and sized
    to the nearest-neighbour spacing (at most 48 px), so targets never
    overlap;
  - `createSeatLayout` guarantees a 28 px minimum spacing, so a dense layout
    has about 28 px targets at 100 % and reaches the preferred 44 px only by
    zooming (a hint says so);
  - every seat is a named button with its selected and disabled state, and
    unavailable seats are not actionable.

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
- **Publication result** (`src/lib/cartPublication.ts`):
  - `addItem`, `updateItem`, `removeItem` and `refreshCart` resolve
    `Promise<CartPublication>`. This is a **frontend** result contract, not a
    backend response;
  - **confirmed** carries the session ID and the exact items that passed the
    existing session guards and were actually published into `CartContext`
    (an empty cart that was cleared is confirmed with `sessionId: null`);
  - **unconfirmed** carries a reason: `unauthenticated`, `session-changed`,
    `session-ended`, `refresh-failed`, or `reconciliation-required` (refused
    by the shared gate below; nothing was sent). It does **not** mean the
    backend did or did not apply the mutation; the outcome is unknown,
    deliberately;
  - a delete is confirmed only by the refresh that publishes the resulting
    cart;
  - `removeItems` (grouped removal of one display line's lock keys) resolves
    a `CartRemovalResult`: `notPerformed`, `confirmed` (with the publication),
    `sessionEnded` (expiry/clear during the removal: never reported as
    removed), or `ambiguous` (partial or unpublished). Every delete settles
    individually (`runGroupedRemoval` in `src/lib/cartReconciliation.ts`); if
    all are definitely rejected, the first rejection is thrown.
- **Shared cart re-read gate** (`cartReconciliation`, owned by `CartContext`):
  - raised by `CartContext` itself for an ambiguous mutation failure
    (transport or 5xx) or an applied change whose refresh could not be
    published, by a partial grouped removal, and by screens through
    `requireCartReconciliation` when a published cart does not show the
    intended change;
  - scoped to the session it was raised in; dropped when that session ends;
  - while active, `addItem`/`updateItem`/`removeItem`/`removeItems` refuse
    without sending, and every transaction surface (Match Details, Cart, cart
    sheet, Checkout, card payment) blocks;
  - only a **confirmed** `refreshCart()` of the gated session releases it.
- **Synchronous guard state:** `readCartGuardState()` returns the current
  session id, item count, whether `expires_at` has been reached (computed from
  the clock, not from the 1-second tick), and whether the gate is active.
  Payment handlers read it at the moment of an action rather than trusting
  the last render.
- **Confirmation invariant.** A resolved mutation promise is **not**
  authoritative success. Transaction-facing screens decide success from a
  confirmed `CartPublication` for the owner's current session whose snapshot
  contains the intended state. After an unknown outcome they re-read the cart
  (`refreshCart`) before retrying, and never replay a mutation blindly. Match
  Details applies this (§7).
- **Expiry**: a 1-second tick computes `secondsLeft`; at zero, or when the app
  returns to foreground past expiry, the session is cleared and the stack is
  reset to `/`. `ReservationExpiryNotice` observes that transition and shows a
  toast; it never changes cart state.
- **Global reservation indicator** (`ReservationHoldBar`, mounted once in
  `AppChrome`): "Reservation held · mm:ss · View" while the owner reports a
  session with items and `secondsLeft > 0`. It shows `CartContext.secondsLeft`
  only (no second timestamp or timer), opens `/cart`, and announces nothing
  per second. It sits in the layout flow above the screen (the screens below
  receive a zero top inset), and is not shown on routes that already present
  the countdown or a transaction surface: `/cart`, `/checkout/*`,
  `/match/[id]` (`src/lib/reservationIndicator.ts`). The header cart action
  no longer repeats the countdown.
- **Restore**: on mount the persisted session is parsed; before a restored
  session is published, its payment gate is restored (§10). Signed-out,
  missing, malformed or expired sessions clear the persisted payment record.
- **Presentation** (`/cart`, `CartSheet`, `src/components/cart/*`,
  `src/lib/cartPresentation.ts`, `useCartLineActions`): lines grouped by
  match; GA quantity changes judged by `quantityChangeConfirmed` and removals
  by `removalConfirmed` against the published cart; the displayed total is
  always the owner's `cart.total` (group subtotals are display-only and
  missing prices show "Price unavailable", never 0); Cart and the sheet never
  clear the cart.
- Unauthenticated `addItem` routes to `/auth`. Signed-out mount removes any
  persisted session ID.
- Consumers use `captureCartSession`, `isCartSessionCurrent`, and
  `clearCartIfSession(ticket)` — never an unconditional clear — in payment flows.

---

## 9. Ticket holders

`TicketHoldersContext` derives one slot per physical ticket from cart items
(`deriveTicketSlots`: `${lock_key}_seat_${id}` / `${lock_key}_ticket_${i}`).
`/checkout/ticket-holders` collects names grouped by match and zone (first
slot pre-filled from the profile name once); Continue focuses the first
incomplete field. The only rule is a non-blank name (`isHolderNameValid` in
`src/lib/checkoutFlow.ts`). `/checkout` redirects back there if any slot lacks
a name. Names are sent as `tickets_by_match`, built by the one shared
`buildTicketsByMatch` for both payment methods.
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
- **Readiness** (`checkoutReadiness`, `src/lib/checkoutFlow.ts`) blocks Pay
  for, in order: no items, reservation expired, cart re-read gate, unknown
  payment outcome, another attempt in progress, busy, missing holders, no
  method, incomplete profile, invalid phone. The first blocker is shown.
- **Pay handler** (`handleContinue`) re-validates with `submissionGuard`
  against `readCartGuardState()` and the payment gate at the moment of the
  press, before either handoff; the rendered session must still be current.

**Payment gate** (`src/lib/paymentOutcomeLock.ts`) — the single per-session
authority for "may a payment start?", shared by Card and BLUE. It stores no
payment status; the backend and portal remain the authority.
- **Attempt.** Every submission first calls `acquirePaymentAttempt(session,
  method)`. The claim is synchronous (a second caller from any surface or
  method is refused as `blocked`), then persisted as
  `lfa_payment_outcome_lock`; only after the write succeeds may the caller
  submit (`notRecorded` → nothing is sent). Each acquisition has an id: the
  owner passes it to its own final guard (`isPaymentAttemptHeldByOther`),
  every other surface passes none and is refused.
- **Final guard.** Immediately before `/checkout/mobile/submit`, with nothing
  awaited in between, each method runs `paymentSubmitBlocker` against
  `readCartGuardState()`: changed/empty session, reservation expired, cart
  re-read gate, unknown-outcome lock, or another attempt → nothing is sent and
  the attempt is settled.
- **Outcomes.**
  - definite non-completion (4xx, 401/403, 503, BLUE failure redirect, or a
    submit blocked before sending) → `settlePaymentAttempt` releases the
    attempt and removes the record (existing retry behavior);
  - unknown outcome (transport failure, timeout, 5xx other than 503, an
    unreconciled BLUE success, or a card 2xx that the closed card screen could
    not reconcile) → `markPaymentOutcomeUnknown`: the session is locked for
    every method; Checkout and the card screen point to My Tickets;
  - trusted success → the cart session is cleared (`clearCartIfSession`),
    which ends the session and its gate.
- **Release.** A lock is released only by a materially different cart session
  (`discardPaymentOutcomeUnlessSession` when `CartContext` publishes a new
  session id). There is no API to look up a payment result, so there is no
  in-app "unlock".
- **Restart.** `CartContext` calls `restorePaymentOutcomeLock` before
  publishing a restored session: a persisted record for that session becomes
  the lock (an unfinished attempt after a restart is an unknown outcome); a
  record for any other session is removed. An unreadable record or a storage
  read failure locks the session being restored (fail closed). In the same
  process, a live attempt for the restored session stays an attempt.
- **Continuing BLUE.** While a BLUE attempt holds the session, the only
  allowed action is reopening its own validated payment URL (the pending
  attempt, `checkoutAttemptBlocks`); Card and a fresh BLUE submit are blocked.
  Reopening after a BLUE failure redirect re-acquires the gate first.

**CyberSource (card)**
1. Selecting "Card" requests a capture context
   (`POST /payments/cybersource/capture-context`) keyed to the cart session.
2. "Continue" creates a card handoff and navigates to `/checkout/card/payment`.
3. `CybersourceUnifiedCheckout` mounts Unified Checkout (native: WebView with
   inline HTML loading the configured SDK script; web: script tag +
   `src/lib/cybersourceWebLifecycle.ts`) and yields a transient token.
4. `CardPaymentScreen` checks the owner state when the token returns
   (the reservation can expire while the form is open), acquires the payment
   attempt, runs the final guard, and submits `POST /checkout/mobile/submit`
   with `payment.transient_token`. Only a successful response for the
   still-current cart session clears the cart (`clearCartIfSession`) and
   routes to `/checkout/success`. Back is refused synchronously while the
   submit is in flight (`canLeavePayment`).

**BLUE (wallet)**
1. `submitBlue` acquires the payment attempt, runs the final guard, posts
   `/checkout/mobile/submit` with `payment_method: "blue"`, validates
   `payment.payment_url` against the configured BLUE origin and a
   `/payment/<id>` path (`validateBluePaymentUrl`), and stores a pending
   attempt for the session (reused on retry instead of resubmitting).
2. Native: navigates to `/checkout/blue/payment`, which loads the URL in a
   WebView. Every navigation passes through `decideBlueNavigation`
   (`src/lib/bluePaymentRedirect.ts`).
3. A terminal success URL (configured redirect origin `/payment/success` or
   `lfa-app://checkout/success?provider=blue`) clears the cart for the
   matching session and routes to `/checkout/success`; a success whose clear
   did not happen is `unreconciled` (`blueSuccessCompletion`) and locks the
   session. A failure URL settles the attempt and returns to `/checkout` with
   the reservation intact. "Leave" keeps the attempt held.
4. Web: `window.location.assign(paymentUrl)`; the in-app BLUE route redirects
   to `/`. The page reload drops in-memory state, so on return the persisted
   record locks the restored session (conservative; see `docs/SECURITY.md`
   §3.16).

Payment failures are classified from HTTP facts only (`paymentFailureKind`)
and shown with catalog copy; an unknown outcome is never presented as
"not charged".

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
- **Permission is never requested at startup.** The native prompt appears
  only after an explicit user action: onboarding's "Turn on notifications"
  (`optInToPushNotifications`) or the Settings action.
- Registration triggers: app start **when permission is already granted**
  (`registerPushDeviceIfPermitted`), an explicit opt-in that grants it, every
  change to an authenticated token (`AuthContext`; `getFcmDeviceToken`
  returns nothing without permission), and every FCM token refresh.
- Notification taps with a `match_id` push `/match/[id]`
  (`src/lib/notificationNavigation.ts`). No other payload routing exists.
  `_layout.tsx` reads them through `getInitialNotificationData` /
  `subscribeToNotificationResponses`.
- Native only; web skips registration.
- **Expo Go is not a push environment.** `src/lib/notifications.ts` is the
  only runtime importer of `expo-notifications`, loaded with a conditional
  `require` guarded by `pushRuntimeSupported = !isRunningInExpoGo()`:
  - since SDK 53, importing `expo-notifications` **throws** on Android Expo Go
    (its auto-registration side effect calls `addPushTokenListener`), which
    previously made every route that imports `_layout`/`AuthContext` fail to
    evaluate and surface as "missing default export";
  - Expo Go has no React Native Firebase native module, so `getMessaging()`
    is never reached there;
  - in Expo Go every helper degrades to "no push" (permission reads as
    `denied`, no token, no-op subscriptions).
  Development and release builds load the module eagerly exactly as before.
  Push, FCM registration and notification taps must be verified in a
  development or release build, never in Expo Go.

---

## 13. Maintenance

Any HTTP 503 (from `apiRequest` or the PDF fetch) calls `activateMaintenance()`;
`MaintenanceGuard` then replaces the entire navigator with
`UnderConstruction503`. The flag is never reset in code and the screen has no
retry, so recovery requires an app restart.

---

## 14. Theming, responsive, accessibility

- **Colors** — `src/lib/themePalette.ts` (`lightColors`, `darkColors`):
  - **values are LFA Screen v3's (`lfa3.css`) in both themes**, including
    the neutral-black dark theme; legacy roles (`bg`, `panel`, `ink`,
    `muted`, `primary`…) map onto the same v3 surfaces so
    not-yet-redesigned screens share them. One documented adjustment: light
    `textMuted` #6C6F7C (v3 #6F7280 is 4.3:1 on v3's background, below AA);
  - semantic roles (`background`, `surface`, `textStrong`, `textMuted`,
    `action*`/`on*`, `disabled*`, `selectedSurface`, `focusRing`, `hero`,
    `skeleton*`, `scrim`, `scanSurface`) and 8 status `tones`
    (neutral, brand, success, warning, danger, info, live, unavailable).
  - Semantic text and tone pairs meet WCAG AA in both themes
    (`src/lib/themeContrast.test.mjs`). The legacy `muted` does not.
  - Tones are presentation vocabulary; mapping a backend status to a tone
    belongs to the screen that owns the data.
  - v3 roles: `heroRaised`, `heroHairline`, `onHeroUrgent`,
    `brandSurface`/`brandGlow`/`brandDeep`/`onBrandSurface`, `segment`,
    `hairline`, `crest`, `brandInk`, `bar`, and the v3 shadow lists
    `shadowCard` (`--shadow`) / `shadowRaised` (`--shadow2`) used as
    `boxShadow`; v3 cards and sheets carry shadows, not borders.
  - Shared primitives follow v3: `Button` (52pt, 17/600, radius 14 iOS /
    20 Android, scale press, `ghost` variant), `BottomSheetModal` (28pt top
    radius, v3 handle/backdrop/shadow, display titles, optional header
    action and sticky footer), `StatePanel` (v3 state card), tab bar (iOS:
    translucent bar, 26pt icons, 10pt labels; Android: 64×32 indicator; a
    selection bounce; no backdrop blur — no blur dependency).
- **Scales** — `src/lib/designTokens.ts` (pure, theme-independent): `spacing`,
  `radius` (incl. `xl` 20 / `xxl` 24 for grouped cards and heroes), `motion`
  durations and `PRESSED_SCALE`, `size` (touch target 48 / 44 minimum,
  control height 52 per v3), `breakpoints` (mirroring `useResponsive`),
  `layout`/`pageGutter`, and `typography` (letter-spacing never used because
  it breaks Arabic joining; tabular digits for prices, totals and timers).
- **Typography families** — `src/lib/fontFamilies.ts`:
  - `text` role → IBM Plex Sans (all UI/body text); `display` role → Barlow
    Condensed, used selectively by the `display*` variants (tab titles,
    section titles, kickoff times, date numerals, countdown);
  - screens never name a family: they pick a variant, and `AppText`,
    `StatusBadge`, `Button` and the tab bar resolve it with `fontStyleFor`;
  - Arabic resolves to the platform font for both roles until an
    Arabic-capable family is chosen (Barlow is never the Arabic dependency);
    display titles are uppercase in Latin only;
  - files load at runtime through `expo-font` (`useAppFonts`, the 7 used
    weights of `@expo-google-fonts/ibm-plex-sans` and `barlow-condensed`); a
    load failure falls back to the platform font and never blocks the app;
  - legacy screens that do not use these primitives still render the
    platform font until they are redesigned.
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
  - `usePressFeedback` — instant pressed scale (opacity under reduced
    motion); `SectionHeader` also has a `display` title variant.
  - Consumers so far: `competitions.tsx` (`StatePanel`); Home, Matches and
    `src/components/match/*` (`AppText`, `StatusBadge`, `SectionHeader`,
    `StatePanel`, skeletons, `DirectionalChevron`); Match Detail, Cart and
    Checkout (`TransactionBar`, plus `src/components/cart/*` and
    `src/components/checkout/PaymentMethodOptions`). The ticket primitives
    are ready for the tickets redesign.
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
  - foundation, navigation, Competitions shell, onboarding, reservation
    indicator and direction-restart strings, plus the screens redesigned so
    far (Home, Matches, Match Detail, Cart, ticket holders, Checkout, payment
    screens); other screens still hold
    inline English and move to the catalog as they are redesigned.
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
16. A resolved cart mutation is not success: success requires a confirmed `CartPublication` for the current session that reflects the intended change; an unknown outcome requires a cart re-read before any retry (§8).
17. Ticket-selection drafts stay transient screen state; a reserved-seat draft is confirmable only against the current successful seat snapshot, and the preflight runs before the first cart mutation (§7).
18. The cart re-read gate is shared and owned by `CartContext`; no surface keeps its own copy, and only a confirmed re-read of the gated session releases it (§8).
19. Every payment submission acquires the session's single payment attempt and persists it before sending, and runs the final owner guard (expiry included) immediately before `/checkout/mobile/submit`; only the acquiring attempt passes it (§10).
20. An unknown payment outcome, or an unfinished attempt found after a restart, locks that cart session for every payment method until a different session exists; a stale lock or attempt never applies to another session (§10).
21. `expo-notifications` is imported at runtime only by `src/lib/notifications.ts`, behind the Expo Go guard (§12).
22. Notification permission is never requested at startup; the native prompt follows only an explicit user action, and an already granted permission keeps registering as before (§12).
23. The global reservation indicator is presentation only: it shows `CartContext.secondsLeft` and has no clock, timestamp or reservation state of its own; expiry stays with `CartContext` and `ReservationExpiryNotice` (§8).
24. Onboarding never navigates or traps an entry: it is offered only on a normal native launch at `/`, steps aside on any navigation, and never runs for signed-in users (§2.1).
25. Font families are chosen only through the typography roles (`fontFamilies.ts`); Arabic never resolves to a Latin family.

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
- screen redesigns that consume these foundations (Phases 5–6; Phases 2–4 are delivered, see §7–§10);
- an Arabic catalog and enabling `ar` (plus the Arabic numerals decision);
- RTL-aware tab swipe and entrance motion;
- migrating legacy colors and `accessibilityState` usage.
