# LFA Arabic/English localization implementation report

Date: 2026-10-21

## 1. Architecture discovered
Expo SDK 57 / React Native 0.86 / React 19 / strict TypeScript. Expo Router uses src/app file routes, shared app chrome and authenticated route wrappers. I18nProvider renders above AuthProvider; CartProvider retains its identity-scoped ownership. Session/token generations remain in services/api.ts and AuthContext. CartContext/cartSession helpers own reservations; TicketHoldersContext owns names; checkoutSubmissionAuthority and existing payment handoffs remain authoritative.

## 2. Existing owners
The existing typed English catalog, custom interpolation and engine-independent CLDR plural engine were extended. No localization dependency was added. Existing storage uses AsyncStorage on native and localStorage on web, under lfa_locale. Backend JSON requests use apiRequest; binary order PDFs use profileService.orderPdf in services/auth.ts; the server /api route forwards web requests. Match map SVG and third-party payment transports are distinct exceptions.

## 3. Implementation
Enabled exactly en/ar. Added Arabic translations for all 844 English keys, plus four Arabic plural forms (848 Arabic entries). Added live language management to the existing provider, a shared accessible selector in Settings and signed-out Profile, and a non-React read-through translation helper. Migrated reachable inline copy in phone selection, dialogs, logout, avatar permissions/actions, payment wrappers, transport errors, formatting fallbacks, seat accessibility and holder labels. Read caches now separate language scopes without changing identity or transaction ownership. TypeScript permits explicit .ts imports for pure helpers shared with the Node test runner.

## 4. Files changed
- src/app/api/[...path]+api.ts
- src/app/checkout.tsx
- src/app/contact.tsx
- src/app/profile.tsx
- src/app/settings.tsx
- src/app/tickets.tsx
- src/components/BottomSheetModal.test.mjs
- src/components/BottomSheetModal.tsx
- src/components/CheckoutPaymentResult.test.mjs
- src/components/CybersourceUnifiedCheckout.native.tsx
- src/components/CybersourceUnifiedCheckout.web.tsx
- src/components/InternationalPhoneInput.tsx
- src/components/LanguageSelector.tsx
- src/components/SheetDismissHandle.tsx
- src/components/cart/ReservationHoldBar.tsx
- src/components/cart/ReservationStatus.tsx
- src/components/checkout/PaymentOutcome.tsx
- src/components/foundation/appTextStyle.ts
- src/components/foundation/direction.tsx
- src/components/ui.tsx
- src/context/AlertDialogContext.tsx
- src/context/CartContext.tsx
- src/context/TicketHoldersContext.tsx
- src/hooks/useProfilePhoto.ts
- src/hooks/useScheduledMatches.ts
- src/i18n/I18nProvider.tsx
- src/i18n/backendHeaders.ts
- src/i18n/i18n.test.mjs
- src/i18n/locales.ts
- src/i18n/localization.test.mjs
- src/i18n/messages/ar.ts
- src/i18n/messages/en.ts
- src/i18n/runtime.ts
- src/lib/accountAndTickets.test.mjs
- src/lib/arabicCountryNames.cjs
- src/lib/arabicCountryNames.d.cts
- src/lib/authSubmissionGuard.test.mjs
- src/lib/checkoutResultParams.ts
- src/lib/checkoutSubmissionAuthority.test.mjs
- src/lib/cybersourceWebLifecycle.ts
- src/lib/format.ts
- src/lib/matchFilterAccessibility.ts
- src/lib/phoneNumber.ts
- src/lib/profileFacts.ts
- src/lib/profilePdfDownload.ts
- src/lib/profilePresentation.test.mjs
- src/lib/queryCache.ts
- src/lib/seatAccessibility.ts
- src/lib/ticketHolders.ts
- src/lib/userFacingError.test.mjs
- src/lib/userFacingError.ts
- src/services/api.ts
- src/services/auth.ts
- src/services/authIdentifiers.test.mjs
- src/services/authSessionOwnership.test.mjs
- src/services/cachedReads.test.mjs
- src/services/matchesCache.test.mjs
- tsconfig.json

This report is also a new artifact: artifacts/localization-report.md.

Excluded user/concurrent changes: app.json and .claude/settings.local.json existed before work; package.json and package-lock.json changed during the session and were not edited or reverted by this implementation.

## 5. Coverage and untranslated areas
All existing English catalog keys have Arabic values with matching interpolation placeholders. Coverage includes onboarding, auth/recovery, Home/Matches/filters, match details, zones/seats, cart/expiry, holders, checkout/payment outcomes, tickets/QR labels, profile/settings, legal/contact shells, notifications, maintenance/update prompts, alerts and accessibility text. Phone-country display uses the already-installed package's Arabic data; identifiers and calling codes stay unchanged.

API-provided names, venues, categories, legal text, notifications and errors remain authoritative; their translation depends on the backend. CyberSource/BLUE hosted content and OS-owned permission dialogs are not translated by this app catalog. Unreachable legacy ProfileDetailModal and the unused PaymentMethodSheet body retain English copy (PaymentMethodIcon remains used). No translation or replacement is applied to QR payloads, ticket/order/payment identifiers or backend currency codes.

## 6. Accept-Language
apiRequest merges all Fetch HeadersInit forms through backendHeaders, then sets the current ar/en value immediately before fetch. Existing authentication, password, Accept and Content-Type behavior is retained, including FormData boundary handling and explicit authorization overrides. PDF requests read the same live preference. The web proxy forwards a per-request en/ar value, defaulting unknown values to en; it never uses server-global language state.

No new header is sent to hosted CyberSource or BLUE pages, SDK script downloads, image requests or the external map SVG path. The LFA capture-context endpoint receives the header as an LFA request; its existing locale: en-us payload remains unchanged. URLs, methods, payloads, maintenance handling, session invalidation and payment outcome decisions are preserved.

## 7. Persistence
Saved values restore before app children render. Missing, invalid and unreadable values default to English. Successful changes persist before publication; failed writes keep the current UI/request language and show an error. Language is independent of login/logout and does not clear identity, reservation or payment state. Provider children stay mounted during switching.

## 8. Arabic / RTL
Arabic uses the existing script-aware typography with the platform Arabic-capable font and expanded line height. Text writing direction follows the selected script. Email/phone/password input, ticket codes, seat identifiers, payment references and reservation countdowns have LTR boundaries; formatted Arabic amounts isolate their number/currency pair. Backend values and stadium geometry are unchanged.

Web updates document lang/dir and an RN Web root View direction context immediately. PhysicalLayout uses an explicit web dir=ltr boundary for map/seat/QR subtrees; native retains the existing physical layout style. Native I18nManager direction changes require a reload/cold start. Switching text/language does not auto-reload an active app: the selector explains the pending direction and offers a user-initiated restart. The existing startup direction mismatch/reload-loop guard remains in place. isRTL reports the active native direction until restart. See the installed SDK's reload API: https://docs.expo.dev/versions/v57.0.0/sdk/expo/ .

## 9. Verification
CONFIRMED local checks:
- TypeScript (npx.cmd tsc --noEmit / direct installed tsc): exit 0.
- Expo lint: exit 0; 0 errors, 2 existing unused-variable warnings: auth.tsx resendRecoveryCode and services/auth.ts fields.
- Full Node suite, including tracked and untracked *.test.mjs: 1064 tests, 1064 pass, 0 fail, 0 skipped/cancelled.
- Focused localization suite: 10/10 pass.
- Expo config --type public --json: exit 0.
- git diff --check: clean after removing an extra EOF blank line.
- Expo web compilation/server smoke: GET /profile HTTP 200, HTML returned; client/server bundles compiled. A direction style warning prompted a web boundary correction, verified by rendering the actual PhysicalLayout with React Native Web inside an RTL tree.

Tests cover invalid saved values, delayed Arabic restoration without English content, persistence failure, immediate future header changes, JSON/PDF/proxy transport, preservation of headers, language-scoped read caches, interpolation/key coverage, Arabic formatting/country names, unchanged holder keys/seat identifiers, native reload deferral, and executable native card bridge errors. Existing authentication-generation, cart/checkout, BLUE/card lifecycle, ticket/QR and source regression tests pass.

## 10. Backend dependency and unverified behavior
NOT VERIFIED: actual backend response translation or supported negotiation behavior. No repository backend implementation, maintained language contract or tests confirmed it. Header delivery is locally verified; it is not evidence that LFA returns Arabic content. No translated backend response is fabricated.

No browser was connected; the in-app browser tool reported unavailable. ADB reported no connected devices. The HTTP smoke test and server-side RN Web rendering are not visual browser/device validation. Real Arabic layout, native reload, screen-reader output, navigation gestures, payment providers, signed-in cart/tickets/PDF and scanner interoperability were not exercised on a device.

## 11. Remaining review
Before release, review Arabic copy and wrapping on small/large iOS and Android devices, mixed-script names and forms, live en/ar/en switching, restart persistence, filters/calendars, stadium/seat geometry, checkout with active reservation, both payment providers, real ticket QR scanning and PDF output. Confirm backend language support with its owner, especially localized errors/legal/notification text.

AGENTS.md section 11, docs/ARCHITECTURE.md section 15 and the Arabic future-work statements in docs/STATUS.md and docs/WORKFLOW.md now describe the previous English-only state. Proposed correction: record the available Arabic catalog/selector/header implementation while retaining the native runtime-verification limitation. Persistent project instructions were left unchanged. No commit, push or staging was performed.
