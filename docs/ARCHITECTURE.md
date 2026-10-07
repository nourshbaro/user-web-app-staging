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
                     └─ SystemStateGate  (maintenance / update states, §13)
                        └─ AppChrome        (src/components/AppChrome.tsx)
                           ├─ ReservationHoldBar  (global reservation indicator, §8)
                           ├─ <Stack> (all routes)
                           ├─ HoldExpiredSheet    (v3 "Reservation expired", §8)
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

**Launch splash (every launch):** `AppChrome` shows the v3 branded
`LaunchSplash` on top of everything on every launch until the gate has
decided and a short brand beat has played (`src/lib/launchSplash.ts`,
`useLaunchSplash`; 1.2 s, 0.5 s under reduced motion). It is in-memory
only (never persisted), never navigates, and does not block routing: a
direct entry resolves beneath it.

### 2.1 First-run onboarding

- **Owner:** `useOnboardingGate` (`src/hooks/useOnboardingGate.ts`) over the
  pure rules in `src/lib/onboarding.ts`; UI in
  `src/components/onboarding/OnboardingFlow.tsx`.
- **Flow (after the launch splash):** three product pages → notification
  pre-prompt (whenever the build has a push runtime; "Turn on" asks the OS
  only if permission is not already granted, "Not now" never asks) → Home.
  Without a push runtime (Expo Go, web) the pages go straight to Home. There
  is no authentication step at startup: sign-in stays in the normal app /
  Profile journey. No favourite-team step (no backend contract).
- **Persistence:** `lfa_onboarding_v1` = `"completed"`. Written when first run
  finishes (either notification choice, or the last page when no pre-prompt
  is offered), and for a signed-in (existing) user at startup so they are
  never sent through it.
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
| `/competitions` | `competitions.tsx` | public | Competition cards, standings, competition matches (`competitionsService`); matches open `/match/[id]` |
| `/tournament` | `tournament.tsx` | public | Legacy route: `<Redirect href="/competitions" />` (kept for old links/allowlists) |
| `/match/[id]` | `match/[id].tsx` | public view; auth to add | Match hero, zones, stadium map, GA quantities, seat selection, one confirmation action |
| `/tickets` | `tickets.tsx` | `withAuthRequired` (tab title) | v3 My Tickets: All/Upcoming/Past portal matches → flip tickets with the backend QR |
| `/profile` | `profile.tsx` | public (own signed-out state) | v3 account hub: avatar (only editable field), read-only details, change password, settings/legal/contact, logout |
| `/change-password` | `change-password.tsx` | `withAuthRequired` | v3 `chpw`: `ChangePassword` (same endpoint and session reset as before) |
| `/notifications` | `notifications.tsx` | `withAuthRequired` | v3 `notifs`: read-only backend inbox (`notificationReads`); match notifications open `/match/[id]` |
| `/edit-profile` | `edit-profile.tsx` | public | Legacy redirect → `/profile` |
| `/settings` | `settings.tsx` | `withAuthRequired` | Theme, notification permission, account deletion (v3 `settings_delete` confirmation) |
| `/delete-account` | `delete-account.tsx` | `withAuthRequired` | v3 `delete_verify`: current password → `DELETE /auth/account`; reached only from the Settings confirmation |
| `/about` | `about.tsx` | public | Legacy redirect → `/legal` |
| `/legal`, `/legal/privacy`, `/legal/terms` | `legal/*.tsx` | public | Legal list and the backend documents (`legalService`) |
| `/contact` | `contact.tsx` | public | Contact LFA (`OFFICIAL_CONTACTS` only) |
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
state resets on identity change. Signed out, a primary tab keeps its
`TabHeader`; every other gated screen (cart, settings, checkout and payment
routes) shows the `FlowHeader` with Back (history, else Home), so a
signed-out deep link is never a dead end. `AuthRequired` passes a `returnTo` limited by
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
| Maintenance flag | `src/services/api.ts` over `createMaintenanceAuthority` (`src/lib/maintenanceAuthority.ts`): `activateMaintenance`, `recheckMaintenance`; read by `SystemStateGate` (`useSyncExternalStore`) | memory |
| App update decision | `useAppUpdateDecision` over `loadAppVersionCheck` (`src/services/appUpdate.ts`, `GET /app-versions/check`, asked once per launch) and `src/lib/appUpdatePolicy.ts`; optional-prompt dismissal in `SystemStateGate` | memory (this launch) |
| System-state dev preview | `src/lib/systemStatePreview.ts` (`__DEV__` only) | memory |
| Theme mode | `ThemeProvider` (`system`/`light`/`dark`) | `lfa_theme` |
| First-run onboarding seen | `useOnboardingGate` over `src/lib/onboarding.ts` | `lfa_onboarding_v1` |
| Custom fonts registered | `useAppFonts` → `setCustomFontsLoaded` (`src/lib/fontFamilies.ts`) | memory |
| Global reservation indicator | derived in `AppChrome` from `CartContext` (`src/lib/reservationIndicator.ts`); holds no state | — |
| App language | `I18nProvider` (resolved against `ENABLED_LOCALES`) | `lfa_locale` |
| Direction-transition marker | `I18nProvider` + `src/i18n/directionTransition.ts` | `lfa_direction_transition` = `{desired, attempts}` |
| Format locale | `src/lib/format.ts` (`setFormatLocale`, set by `I18nProvider`) | memory |
| Match list/detail/seat/filter reads | `src/services/matches.ts`, over the shared read cache (§5a) | memory |
| Competition and portal reads (My Tickets, Home ticket card) | `src/services/cachedReads.ts` (`competitionReads`, `portalReads`) over the raw services, shared read cache (§5a); portal reads scoped to the user-scoped cache generation | memory |
| Ads banner reads | `src/services/ads.ts`, shared read cache (§5a) | memory |
| Scheduled-match screen state (Home, Matches) | `useScheduledMatches`, one instance per screen (filter-tagged snapshot, loading, refresh, retry) | memory |
| Match filter values | `MatchesList` (composition-level `useState`) | memory |
| Ticket-selection drafts (GA quantities, reserved-seat picks) | `src/app/match/[id].tsx` local state — transient, never a cart authority | memory only |
| Toasts / dialogs | `ToastContext`, `AlertDialogContext` | memory |

Not used by any route (do not assume they own anything):
`src/context/CardPaymentPreparationContext.tsx`, `src/components/ProfileDetailModal.tsx`,
`src/lib/bluePaymentDiagnostics.ts` (marked temporary), and
`getExpoPushToken` / `getDevicePushToken` in `src/lib/notifications.ts`.

---

## 5a. Read cache (memory)

Ordinary GET reads that are safe to reuse go through one small in-memory
cache, `createQueryCache` (`src/lib/queryCache.ts`). It is not a store:
services keep the API contract and response validation, and screens keep their
request authorities, loading, error and empty states. Nothing is persisted.

- **Owners.** `matchesService` (match lists, filters, detail, seats) and
  `adsService` (banner) use it inside the service. Competitions, portal and
  notification reads use it through `src/services/cachedReads.ts`
  (`competitionReads`, `portalReads`, `notificationReads`), which wraps the
  unchanged `competitionsService` / `profileService` /
  `notificationInboxService`.
- **Keys** are the request path with every meaningful parameter (filters,
  status, date, competition, match, zone), so different requests never share
  an entry.
- **Freshness is per resource.** Each resource has a fresh window (served
  without a request) and a stale limit (may be shown immediately while it
  revalidates; older entries are not shown). Live and seat data have much
  shorter windows than scheduled data. The current values are in
  `docs/API_INTEGRATION.md` §13; they are tuning, not contract.
- **In-flight deduplication.** Identical concurrent reads (e.g. Home and
  Matches asking for the same list) share one request; a forced read starts
  its own.
- **Latest request wins.** A response is accepted only if no newer request
  or invalidation for the same key happened after it started. A response
  that lost authority is not cached, runs no side effects (`onAccept`), and
  is not handed to its caller as data: the caller receives the newer
  request's result, a newer accepted entry, or — after an invalidation — a
  fresh read. So an older, slower response can never overwrite newer data or
  regress a screen.
- **Failures are never cached.** A failed read leaves any earlier good entry
  untouched; the screen shows its usual error / retry.
- **No loading flash on revisit.** Screen owners seed their first render
  synchronously from the cache (`peek…`) — `useScheduledMatches`, Tickets,
  Competitions, the Home ticket card and the banner — then let the service
  decide whether a request is needed. Without a showable entry they show the
  normal loading state.
- **Revalidation** (`useLiveRevalidation` over `src/lib/liveRevalidation.ts`):
  each re-read carries its reason. The Live tab's 30 s interval is always a
  forced read (it is never skipped); a focus or foreground re-read respects
  the resource's freshness. Background reads never show a loading or
  refreshing indicator. Pull-to-refresh and every explicit Retry are always
  forced (a cached answer, e.g. "Standings unavailable", is never replayed
  as a retry).
- **Explicit invalidation.**
  - Successful checkout: `/checkout/success` (where card and BLUE successes
    land) invalidates every portal read, so My Tickets and Home re-read.
  - Unknown-payment / payment-lock recovery: the "View my tickets" actions
    (Checkout, Card and BLUE screens) open `PAYMENT_RECOVERY_TICKETS_ROUTE`
    (`/tickets?refresh=payment`, `src/lib/paymentRecoveryTickets.ts`). My
    Tickets drops every portal read before its first render
    (`beginTicketsVisit`), so it shows what the backend says now. This only
    refreshes reads: the unknown outcome and the lock stay as they are, a
    missing ticket is never read as a failed payment, and nothing in the
    cart or payment state is cleared. Ordinary visits keep normal caching.
  - Live transitions: only an **accepted** unfiltered live answer is compared
    with the previous live set (`onAccept`). When a match entered or left
    play, every other match list (scheduled, completed and filtered,
    including filtered live lists) and those matches' details are dropped,
    and competition matches / standings are dropped (list items do not name
    their competition, so all of them; the competition list is kept). The
    accepted live answer itself is kept. Mounted owners subscribed through
    `onLiveTransition` — every `useScheduledMatches` instance and the
    Competitions screen — re-read in the background instead of keeping an
    obsolete snapshot. Nothing new polls.
  - A push received or opened (`invalidateNotifications`, wired in
    `src/app/_layout.tsx`): the inbox and unread count are dropped and the
    mounted owners (Home bell, inbox) re-read. Nothing polls.
  - Identity change: see isolation below.
- **Private data isolation.** The portal read cache (portal matches /
  tickets, notification inbox and unread count) is scoped to the
  user-scoped cache generation (`src/lib/userScopedCache.ts`): login, logout,
  account switch and 401/403 invalidation drop every entry, and a response
  that started under the previous identity is discarded. Public match,
  competition and ad data are not user-scoped.
- **Outside the read cache (by design).** Cart and reservation reads and
  mutations, checkout submission, the CyberSource capture context, BLUE,
  payment attempts and outcomes, `/auth/me`, device registration, PDF and the
  per-ticket QR fallback (`profileService.ticket`) do not use it. The
  pre-commit match re-check before a cart mutation stays a forced read.

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
  read cache (§5a). The data source is **scheduled matches** only.
- **`useScheduledMatches`** (`src/hooks/useScheduledMatches.ts`) is the
  screen-level owner:
  - initial load (seeded synchronously from a showable cache entry), retry,
    pull-to-refresh (forced) and background revalidation (a forced Live
    poll, or a focus / foreground re-read that respects freshness; §5a);
  - request authority (`createRequestAuthority`), plus a synchronous
    `invalidate(nextFilters)`;
  - loading and error state;
  - a snapshot that tags successful results and errors with the filter
    identity that produced them (`src/lib/matchQuery.ts`).

  Home and Matches each use their own hook instance; they share only the
  service cache (and its in-flight requests).
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
    backend returns such matches; backend scores only (`matchScore`); the
    live minute is the list item's own clock (`liveClockOf`). Each card
    opens `/match/[id]`; "See all" opens Matches on the Live / Results
    segment (`matchesTabRoute` → `/matches?tab=…`, read once by
    `MatchesList` through `matchTabFromParam`; no new owner);
  - My Tickets card: `useNextTicketMatch` (`portalReads.matches("upcoming")`
    over `profileService`, request authority + user-scoped generation,
    signed-in only) → "{n}
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
- **Status gating (hard boundary):** only a `scheduled` match is a
  ticket-purchase experience (`matchDetailExperience` /
  `isPurchasableMatchStatus` in `src/lib/ticketSelection.ts`). Live,
  completed and any other status render `MatchInfoView` (v3 result screen:
  score hero, Timeline / Stats from the real single-match data) with no
  zones, stepper, seat picker or cart action, even when zones are present;
  no zone is selected and no seats are loaded for them.
  `executeSelectionCommit` requires `confirmStillOnSale`, which the screen
  implements by re-reading the match through its own `loadMatch(force)`
  owner immediately before the first cart mutation. Not scheduled
  (`notOnSale`) or unreadable (`statusUnverified`) means zero cart calls;
  `notOnSale` discards the stale draft, and the screen is already showing
  the fresh status. The backend stays authoritative for any race after that
  check.
- **v3 presentation** (all state stays in `match/[id].tsx`):
  - the stadium map is collapsed by default behind "Show map / Hide map";
    visibility is presentation state only (no refetch; the map-size probe and
    match load do not depend on it);
  - the zones are one radio list; selecting a zone never mutates the cart;
  - a GA zone's quantity stepper lives in the action bar for the selected
    zone;
  - a reserved zone's "Choose seats" opens the seat picker, a **view of the
    same screen** (not a route), so the draft, seat snapshot and
    confirmation keep one owner. Hardware back closes the picker first.
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
  - Seat reads are cached only briefly (§5a), but any snapshot can age, so
    the backend stays the final authority for races after the preflight.
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
  returns to foreground past expiry, `expireCart` first captures a minimal
  snapshot (`expiredHoldFrom`, `src/lib/holdExpiry.ts`): the expired cart's
  unique match ids and whether any payment touched the session (attempt,
  pending BLUE request or unknown-outcome lock). It then clears the session
  (same-session guarded), dismisses every transaction screen (and any payment
  WebView) to `/`, and publishes the snapshot as `expiredHold`.
  `HoldExpiredSheet` (in `AppChrome`) presents the v3 "Reservation expired"
  sheet over Home: **Start again** → the one match's `/match/[id]` (a fresh
  selection; nothing is re-reserved) or Matches on Upcoming when the hold
  spanned several matches; **Back to home** (and Android back) closes it. "No
  payment was taken" appears only when no payment touched the session. The
  snapshot holds no seats, lock keys, session, checkout state or payment data,
  and any later reset (logout, a new session) retires it. The snapshot is
  published in the same update as the clear, and the Checkout / holders
  empty-cart redirects to `/cart` stand down while `expiredHold` is set, so
  Home (not an empty Cart) stays under the sheet.
- **Global reservation indicator** (`ReservationHoldBar`, mounted once in
  `AppChrome`): "Reservation held · mm:ss · View" while the owner reports a
  session with items and `secondsLeft > 0`. It shows `CartContext.secondsLeft`
  only (no second timestamp or timer), opens `/cart`, and announces nothing
  per second. It sits in the layout flow above the screen (the screens below
  receive a zero top inset) and is **the** countdown on Match Details, ticket
  holders and Checkout (v3). It is not shown on `/cart` (which has its own
  countdown card, `ReservationStatus`), the Card/BLUE payment screens or the
  result screens. Inside `/checkout*` it is read-only (no "View", no jump to
  Cart mid-submission). Routes live in `src/lib/reservationIndicator.ts`. So
  every screen shows at most one countdown, all derived from `secondsLeft`;
  holders and Checkout keep the thresholded screen-reader warnings through
  `useReservationAnnouncements`. The header cart action no longer repeats the
  countdown.
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
order state. The v3 presentation (`src/components/checkout/PaymentOutcome.tsx`,
copy keys from `src/lib/checkoutResultPresentation.ts`) is chosen by the
production state that routed there:
- success only after the existing trusted, matched completion;
- "didn't go through" only for the provider's failure return, never claiming
  that no order exists;
- unknown outcomes stay inside the Card/BLUE screens and Checkout (locked),
  never as a failure.
Detail rows show backend-provided values only.

**Checkout Back:** header and Android hardware Back share one policy
(`checkoutBackBlocked` / `checkoutBackHandlers` in `src/lib/checkoutFlow.ts`)
over the existing synchronous guards (`submitInFlightRef`,
`blueHandoffStartedRef`). Leaving is refused while a submit is in flight or
a BLUE handoff has started; hardware Back is always consumed; the header is
visibly disabled while submitting. The Card handoff navigates synchronously,
and the Card screen keeps its own in-flight back guard.

**Checkout presentation (v3):** choosing a payment method only records the
choice (and, for Card, prepares the capture context). The single explicit
action ("Pay {total}" / "Continue with BLUE") runs `handleContinue`. Card
entry is always CyberSource's own form.

---

### Payment-method switching (post-redesign)

- Choosing a method holds nothing; opening the card form and backing out
  holds nothing (the attempt is acquired only when the card token is
  submitted). So BLUE ↔ Other is freely reversible until a payment request is
  sent.
- "Continue with BLUE" submits to the backend, which creates the BLUE order
  (`order_id` / `order_number`; the BLUE page shows it) and returns its
  `payment_url`; the URL is stored with the pending attempt
  (`savePendingBluePaymentAttempt`). While the BLUE page is open the attempt
  is in progress (Card waits). Leaving the BLUE page without a result
  **parks** the attempt (`parkPaymentAttempt`): it keeps its restart record but
  blocks nothing, so both methods stay selectable:
  - BLUE re-holds the parked attempt and reopens the stored URL; nothing is
    submitted, so no second BLUE order is created.
  - Other starts its own card attempt (`/checkout/mobile/submit` with a
    transient token is a separate backend order; the BLUE order is never
    reused or rewritten). A definite card failure restores the parked BLUE
    attempt and record; an unknown card outcome locks the session for every
    method; a card success clears the session (and the pending BLUE record).
- Still blocking: an in-progress attempt (card submit in flight, BLUE page
  open), an unknown outcome, and a restart with an unsettled record (the
  stored BLUE URL lived only in memory, so it fails closed).
- BLUE deep-link results (`/checkout/blue/success|failed`) are display-only;
  only the live BLUE WebView for the handoff's own session can clear a cart.
  **Backend dependency:** a BLUE order left open can still be approved in the
  BLUE app after a card payment completed for the same reservation; the app
  cannot see or cancel it (no cancel / status endpoint, no idempotency
  contract). Reconciling that is backend-owned.
- Card and BLUE payment screens use the v3 `FlowHeader` and the global
  reservation bar (read-only there); the legacy `AppHeader`, its
  `CartTimerPill` and `HeaderActions` are removed. The shared alert dialog
  uses the v3 dialog presentation.

## 11. Tickets, orders, QR, PDF (`src/app/tickets.tsx`)

- List: `portalReads.matches(filter)` → `profileService.matches(filter)` with
  filter `all | upcoming | past` (`GET /portal/matches`), validated by
  `isPortalMatch`. Pull-to-refresh and Retry force a read.
- Detail: `portalReads.tickets(matchId)` → `profileService.tickets(matchId)`.
  A listed ticket's `qr_image` may
  be absent, null or empty (the ticket stays valid); `withBackendQrs` then
  takes **only** `qr_image` from `profileService.ticket(code)`
  (`GET /portal/tickets/{ticket_code}`), when it passes `ticketQrSource`. A
  failed detail request shows the detail error / retry state.
- **QR** (`ticketQrSource`): rendered only from backend `qr_image` values that
  are bounded raster base64 data URIs (`data:image/png|jpeg|webp;base64,…`,
  ≤ 512,000 characters — the allowlist the LFA web client applies to the same
  API); otherwise "QR unavailable". SVG, URLs, storage paths and other schemes
  are rejected. The client never generates QR codes.
- **Status** (`ticketVisualState`, `src/lib/ticketPresentation.ts`): the
  backend `status` decides. `valid` (→ used when `checked_in_at` is set),
  `used`/`checked_in`, `expired` and `cancelled`/`canceled` map to the v3
  states; any other value is shown with its own label and no invented
  meaning (a check-in timestamp never overrides an unknown status). Only
  `valid` presents the QR as scannable; used/expired/cancelled dim and stamp
  it. Upcoming/Past come from the portal filter and `is_upcoming`, never the
  kickoff date.
- **Presentation (v3):** stub cards grouped Upcoming / Past, and a modal ticket
  viewer (pager of flip tickets: front = backend facts, back = QR). Gate,
  block, price and category are not shown (no such fields). Tapping the ticket
  surface flips it (the buttons stay the accessible path; each surface sets an
  explicit face, so nested buttons never double-flip). The back face replays
  the v3 QR fade-in and the used / cancelled / expired stamp pop
  (`lfStamp`); reduced motion swaps faces with both in place. Each pager page
  reserves room for the raised shadow (the paging `ScrollView` clips).
- **After a purchase:** `/tickets?match=…&order=…` opens that match's viewer
  once (from the screen's own list) at the order's first ticket
  (`purchasedTicketFocus`, `ticketFocusIndex`).
- Payment details / PDF: the v3 screen has no entry point (the previous UI had
  already commented them out). `profileService.order`, `orderPdf` and
  `downloadProfileOrderPdf` are unchanged for a future caller.
- Staleness: `createRequestAuthority` per list/detail plus the user-scoped cache
  generation. The list and detail reuse this identity's recent portal reads
  (memory only; §5a): they render at once and revalidate when stale. A
  successful checkout invalidates them; an identity change drops them; a
  visit from unknown-payment / payment-lock recovery (`refresh=payment`)
  drops them before the first render, so it always reads the backend.

---

## 11a. Competitions and account screens

- **Competitions** (`src/services/competitions.ts` over `src/lib/competitions.ts`):
  list, standings and matches through `competitionReads` (§5a: revisiting a
  competition reuses its recent data; pull-to-refresh and every Retry force a
  read; a match entering or leaving play makes the selected competition
  re-read quietly); request authorities per list and per selected
  competition. Standings states: a successful `standings: []` → "No
  standings"; a 404 → "Standings unavailable" with retry (never "No
  standings": the 404 is ambiguous, see `docs/API_INTEGRATION.md`); a
  malformed success (no `standings` array, or any incomplete row), server or
  network failure → error with retry. A `cup` (backend `format`,
  `standingsPlanFor`) requests no standings at all: a knockout note, then
  its matches. Every
  match opens `/match/[id]`, whose backend status decides purchase vs
  live/result. No second Match Details.
- **Profile**: data from `/auth/me` (cached `auth.user` until it loads).
  Name, email and phone are read-only (no update API); "Verified" and "Member
  since" appear only from `email_verified_at` / `created_at`. The avatar is
  the only mutation (`useProfilePhoto`: gallery/camera permissions, upload,
  remove, then `AuthContext.updateUser`). **Result ownership**
  (`runOwnedAvatarMutation`, `src/lib/avatarMutationOwnership.ts`): the
  authentication snapshot is captured before the request, and the result is
  published (`updateUser` + persisted user) only if that generation is still
  current; logout, login, restoration and invalidation replace it, so a result
  started by one account is dropped, never published into the next. Logout:
  the confirmation, then `auth.logout()` (session cleanup unchanged).
- **Settings**: push state is the live OS permission; the only action opens
  the phone's settings. Both exist only on iOS / Android builds with a push
  runtime (`pushSettingsSupported`); on web (and Expo Go) the card says push
  is not available and shows no action. Appearance = `ThemeProvider` mode. Language is shown,
  not switchable (English is the only complete catalog). Account deletion is
  two explicit steps: the v3 `settings_delete` confirmation (the shared
  destructive alert, no backdrop / Back dismissal), then `/delete-account`
  (`DeleteAccount`, v3 `delete_verify`), which collects the current password
  the backend requires and calls `AuthContext.deleteAccount` (unchanged:
  `DELETE /auth/account { password }`, then session cleanup). Nothing is sent
  without a password, a second press never sends twice, and the screen cannot
  be left while the request is in flight.
- **Auth** (`/auth`): v3 presentation over the production flows. Sign in
  with email **or** phone (v3 toggle; `LoginIdentifier`), with phone
  completion after an email sign-in that answers `phone_required`; register
  with an optional email; password recovery owned by
  `src/lib/passwordRecovery.ts` (`recoveryReducer` + attempt counter, held by
  the screen):
  - email → code → new password → Sign in;
  - phone without an email (`reason: "email_required"`) → add email
    (`/auth/forgot-password/add-email`) → code → new password → Sign in;
  - phone, any other successful answer → code immediately, bound to the
    phone that started the attempt (`phoneCodeSent`; verify / reset / resend
    keyed by `recoveryTarget`). Phone → code is implemented; Phone → code →
    new password → Sign in is **not yet end-to-end functional**: staging
    verify / reset reject `phone` with 422 "The email field is required."
    (verified 2026-10-07), shown inline. Pending backend contract,
    `docs/API_INTEGRATION.md` §5.2–§5.3.
  Code steps use `OtpCodeInput` (`src/components/account/`): six cells over
  one numeric value and one native input (paste, OS one-time-code
  autofill), never mirrored; resend is a real request with no countdown.
  Copy is in the `auth.*` catalog keys. Login and Register have **no OTP step of their own**
  (`credentialOutcome`, `src/lib/authCredentialOutcome.ts`): a token → signed
  in; an account id without a token → the backend's verification code
  (`verify-otp`); neither → sign in. The former client-side email
  verification pre-check before Login is removed. Change password is the
  pushed `/change-password` screen (`ChangePassword`, v3 `chpw`, from the
  Profile menu) with the same validation, endpoint and post-change session
  reset. Neither account screen offers v3's "Forgot password" link: the
  recovery flow lives in the signed-out `/auth` screen. No startup
  authentication.

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
  `subscribeToNotificationResponses`. On web `getInitialNotificationData`
  returns `null` (a push never launches the web app, and the launch response
  is not implemented there; reading it threw on every web start).
- **Inbox freshness.** A notification received while the app is open
  (`subscribeToReceivedNotifications`) or opened from the tray drops the
  cached inbox and unread count (`invalidateNotifications`); the Home bell and
  an open inbox re-read them from the backend. The push payload is never
  trusted for any state, and there is no polling.
- **Inbox (`/notifications`) and Home bell.** Backend data only
  (`GET /portal/notifications`, `GET /portal/notifications/unread-count`).
  The API is read-only: nothing marks a notification read, the count is never
  lowered locally, and v3's "Mark all as read" is not offered. Only
  `target_type === "match"` with a valid match id opens `/match/[id]`; other
  notifications are plain rows.
- Native only; web skips registration. Settings shows push as "Not
  available" on web and in Expo Go (`pushSettingsSupported`).
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

## 13. System states: maintenance and app updates

`SystemStateGate` (`src/components/maintenance/`) is the one owner of what
the system states render. Exactly one shows, never stacked, in the fixed
priority of `systemState` (`src/lib/appUpdatePolicy.ts`, LFA Screen v3
layering):

**maintenance → required update → optional update → normal app**

- **Maintenance (existing backend authority).** Any HTTP 503 (from
  `apiRequest` or the PDF fetch) calls `activateMaintenance()`. The gate
  replaces the navigator with `MaintenanceScreen` (v3 `maintenance`); the
  providers above it (auth, cart, holders) stay mounted and untouched, so
  maintenance never logs out, clears the cart or touches a payment. When it
  clears, the navigator mounts again at its initial route.
  - **Recovery:** "Try again" calls `recheckMaintenance()`
    (`src/services/api.ts` over `createMaintenanceAuthority`). It sends one
    anonymous, read-only `GET /matches/scheduled/filters` through
    `apiRequest` (`overrideAuthorizationToken: null`,
    `skipUnauthenticatedNotify: true`, so a 401 can never end the session).
    A 2xx clears maintenance unless another 503 arrived while it was in
    flight. A 503, a transport failure or any other status keeps it.
    Single-flight; the button is busy while it runs. Nothing else clears the
    flag, and there is no polling.
  - "Contact LFA on WhatsApp" uses the official contact
    (`OFFICIAL_CONTACTS`, `src/lib/contact.ts`).
- **Required / optional update (backend authority:
  `GET /app-versions/check`).** `loadAppVersionCheck` asks once per launch
  with the running platform (`android` / `ios`) and the installed version
  (the binary's Expo config; a development client reads the dev server's
  manifest instead). The request carries no session token and a 401 never
  touches the session. The gate remounts when the signed-in identity changes
  (it sits inside the identity-keyed providers), so the answer is memoized
  for the launch; an optional-prompt dismissal resets with that remount.
  `decideUpdate` turns the validated answer into one decision; the app does
  no version comparison of its own. Required wins if both flags are set.
  - **Fail open:** web, an unusable installed version, a network failure, a
    malformed answer, or an update without a valid official store listing →
    no update state. A failed check never blocks anyone.
  - `UpdatePromptDialog` (v3 `update_available` / `update_required`): a
    modal over the running app. Required: no "Not now", the scrim does not
    dismiss, Android Back is swallowed, opening the store never clears it.
    Optional: "Not now" (or Back) dismisses it for the offered version (or
    the unversioned offer), for this launch; the scrim does not dismiss it.
  - The store button opens only a validated official listing
    (`validStoreUrl`: whole-string allowlist, not `URL` parsing, because
    React Native's `URL` is a lenient shim), re-validated at the moment of
    opening. No store URL → nothing opens; an inline error is shown.
  - Copy: v3's version-specific wording only with a real `latest_version`;
    otherwise version-free copy. The "What's new" panel renders the backend
    `message` as bullet points (`messagePoints`: a "." followed by
    whitespace or the end ends a point, so versions, domains and decimals
    stay intact; empty segments are dropped; plain text, never HTML); no
    message → no panel.
- **Development preview (`__DEV__` only).** `src/lib/systemStatePreview.ts`,
  driven by a dev deep link `lfa-app:///?systemStatePreview=maintenance` |
  `updateAvailable` | `updateRequired` | `normal`. It overrides the
  rendered state only. It never sets the real maintenance flag, and it
  carries no store URL, version or release notes. Preview "Try again" runs
  the same real probe. Production builds ignore it.
- Motion: v3 `lfFade` (screen / scrim, 250 ms) and `lfDialog` (card scale
  1.08 → 1 with fade, 300 ms, `cubic-bezier(.22,1,.36,1)`); reduced motion
  → the final state immediately.

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
  - `TransactionBar` — presentation-only action bar (row or v3 stacked layout,
    optional leading content and note); receives values and callbacks from
    the existing owner and holds no transaction state.
  - `FlowHeader` / `StepBar` (`src/components/FlowHeader.tsx`) — v3 flow header
    and holders→payment step bar; Back is the screen's own handler.
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
  other decorative motion: entrances, the ticket flip (instant face swap),
  sliding segment thumbs, the live-dot blink, skeleton shimmer, and the
  slide-in of every modal sheet (`BottomSheetModal`, `ProfilePhotoSheet`,
  the ticket viewer, the phone-country picker), which fades in place instead.
- Completed match (`src/lib/matchMotion.ts`): Timeline rows rise in (v3
  `lfEnter`); Stats rows do not move — only the share bars grow from the
  centre line (v3 `lfBar` 0.7 s, 120 ms + 50 ms per row, ease-out) each time
  Stats is shown. Values and labels are final from the first frame; a missing
  statistic keeps "—" and has no bar. Reduced motion: final state at once.
- RTL readiness (English only today): layouts use start/end props;
  forward/back and disclosure arrows use `DirectionalChevron` (including the
  payment screens' `FlowHeader` and the ticket pager);
  stadium, seat and QR geometry sit in `PhysicalLayout`; Arabic text falls
  back to the platform font for both type roles (`fontFamilyFor`).
- Touch targets: controls drawn smaller than 44pt to match v3 (segments,
  "Show map", Filters, the Home avatar) reach ≥ 44pt on native through
  `hitSlop`; react-native-web ignores `hitSlop`, so their web pointer
  target is the drawn size (34–40px).
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
  - Every `accessibilityState` selected/checked/disabled/expanded value now
    has its `aria-*` twin (Batch 10 audit).
  - The legacy `muted` colour remains in a few non-redesigned surfaces
    (phone-number field, password sheet, toasts, dialogs, CyberSource
    loading, maintenance screen); redesigned screens use `textMuted`.

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
9. 503 → maintenance, 401/403 → session invalidation remain centralized in `apiRequest`; maintenance clears only through `recheckMaintenance` (a successful backend probe), never by setting the flag.
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
23. The global reservation indicator is presentation only: it shows `CartContext.secondsLeft` and has no clock, timestamp or reservation state of its own; it is the one countdown on Match Details, holders, Checkout and the Card / BLUE payment screens (Cart shows the same value in its v3 card). Expiry stays with `CartContext`; `HoldExpiredSheet` presents its snapshot (§8).
24. Onboarding never navigates or traps an entry: it is offered only on a normal native launch at `/`, steps aside on any navigation, and never runs for signed-in users (§2.1).
25. Font families are chosen only through the typography roles (`fontFamilies.ts`); Arabic never resolves to a Latin family.
26. The shared read cache (§5a) is memory only and never caches failures; a response that lost authority never lands, never triggers side effects and is never shown; private (portal) reads are scoped to the user-scoped cache generation and never reused across identities; a successful checkout and unknown-payment recovery invalidate them; Live polling and explicit Retry stay forced reads; cart, reservation, checkout, payment, CyberSource and BLUE never go through it.

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
