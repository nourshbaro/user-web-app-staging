# AGENTS.md — LFA User App (`user-web-app`)

Repository-wide contract for every coding agent (Claude Code, Codex, or other).
Read this file before every task. It is intentionally short; details live in `docs/`.

---

## 1. What this repository is

The **production** LFA Tickets consumer app: Expo SDK 58 / React Native 0.88 /
React 19 / TypeScript (strict) / Expo Router (file-based, `src/app`). It ships
to iOS and Android (`com.lfaticketing.app`) and to web (Expo Router server
output with an `/api` proxy route).

It is the engineering source of truth. The current initiative is a UI/UX
redesign **in place** — not a rewrite, migration, or replacement.

Expo changes between SDKs. Before writing Expo-specific code, consult the
documentation for the SDK version actually installed (`package.json` → `expo`),
not memory of older SDKs.

---

## 2. Instruction precedence

1. The user's explicit instructions for the current task.
2. `AGENTS.md` (this file).
3. Agent-specific files (`CLAUDE.md`, etc.) — they complement, never override, this file.
4. `docs/ARCHITECTURE.md`, `docs/API_INTEGRATION.md`, `docs/SECURITY.md`, `docs/WORKFLOW.md`.
5. `docs/STATUS.md` (volatile; may be stale).

Source code is the evidence of what currently exists. If docs and code disagree,
do not silently "fix" either one — report the discrepancy (see §4).

---

## 3. Required reading

| Task touches…                         | Read first                                 |
| ------------------------------------- | ------------------------------------------ |
| anything                              | `AGENTS.md`, `docs/STATUS.md`              |
| screens, state, navigation            | `docs/ARCHITECTURE.md`                     |
| any request, service, response shape  | `docs/API_INTEGRATION.md`                  |
| auth, cart, checkout, payment, tickets, push, WebViews, config | `docs/SECURITY.md` |
| planning, review, handoff, commits    | `docs/WORKFLOW.md`                         |

---

## 4. Documentation is read-only by default

`AGENTS.md`, `CLAUDE.md`, and everything in `docs/` are persistent project
instructions. During normal implementation or review work agents **must read
them and must not modify them** unless the user explicitly authorizes a
documentation change for that task.

This includes `docs/STATUS.md`. It holds volatile state, but it is still only
edited with explicit authorization.

When work reveals stale or wrong documentation:

1. report the discrepancy (file, statement, contrary evidence),
2. state the proposed correction,
3. leave the documentation unchanged,
4. wait for explicit user approval.

---

## 5. Production-first rule and the generated reference

A separately generated Expo project (`claude gen AI lfa ui`, outside this repo)
is a **design / UX / product-direction reference only**. It has no architectural
relationship with this repository.

It may inspire presentation: hierarchy, layout, states, tokens, typography,
navigation labeling, QR-first ticket layout, Arabic/RTL-aware design.

It is **never** authoritative for: architecture, routing, auth, API integration,
state ownership, cart/reservation logic, checkout, CyberSource, BLUE, tickets,
QR generation, backend contracts, or security behavior. It is built on a
Zustand store over mock data, a hash-seeded placeholder QR, `Math.random`
order numbers, timed fake "processing", and a demo route — none of which may
enter production.

Every adopted idea must be wired to real production data and existing owners.
Full approved/rejected lists: `docs/WORKFLOW.md` §5.

---

## 6. Inspect before changing

Before modifying a feature, identify from source (not filenames):

- the route and component tree,
- the state owner (context / lib authority / local state),
- the service calls and their call sites,
- related types, persistence, and tests,
- loading / error / empty behavior,
- security-sensitive behavior.

Filenames mislead in this repo: e.g. `src/context/CardPaymentPreparationContext.tsx`
and `src/components/ProfileDetailModal.tsx` exist but are not used by any route.
Trace imports.

---

## 7. Preserve existing ownership

Do not create a second owner for state that already has one. Current owners
(details in `docs/ARCHITECTURE.md`):

- Session / token: `src/services/api.ts` (authentication generations) + `src/context/AuthContext.tsx`.
- Cart / reservation: `src/context/CartContext.tsx` + `src/lib/cartSession*.ts`; backend is authoritative.
  - Screens may hold transient selection drafts only until the `CartContext` mutation.
  - A resolved cart mutation is not success. Decide success from the returned
    `CartPublication`, which must be confirmed for the current session.
  - After an unknown outcome, re-read the cart before retrying
    (`docs/ARCHITECTURE.md` §8).
- Ticket-holder names: `src/context/TicketHoldersContext.tsx`.
- Checkout submission and capture context: `src/app/checkout.tsx` with `src/lib/checkoutSubmissionAuthority.ts` and `src/lib/requestAuthority.ts`.
- Payment handoffs: `src/lib/bluePaymentHandoff.ts`, `src/lib/cardPaymentHandoff.ts`.
- Payment retry consent: `src/lib/paymentOutcomeLock.ts` owns the gate;
  Checkout offers explicit "Pay again" confirmation after an unknown result,
  including for the same reservation. Re-read and confirm the current cart
  before enabling a new attempt. Consent never resolves the earlier payment,
  replays its submitted token, or bypasses an active attempt. Deleting a
  My Tickets notice is presentation only (`docs/SECURITY.md` §2.8).
- Maintenance: `src/services/api.ts` (503 → `MaintenanceGuard`).
- Theme: `ThemeProvider` in `src/components/ui.tsx`.
- Scheduled-match discovery:
  - `src/services/matches.ts` (`matchesService`) owns the API contract and cache;
  - `src/hooks/useScheduledMatches.ts` is the screen-level loading owner for Home and Matches;
  - do not add a second fetch or state for scheduled matches;
  - filter changes must keep the synchronous request invalidation and filter-tagged results;
  - `src/components/match/*` is presentation-only.

Backend JSON/API calls go through the service layer (`src/services/*`) and
`apiRequest`, which owns auth headers, 401/403 invalidation, 503 maintenance,
timeouts, and error types. Do not add ad-hoc backend calls in screens or
components; first check which service already owns the data.

Existing specialized transports are intentional exceptions: binary PDF
retrieval (`profileService.orderPdf`), the SVG map-metadata fetch in
`src/app/match/[id].tsx`, and the web `/api` proxy. They are not permission to
bypass auth, stale-request protection, or error handling for normal backend
calls. If you find a direct network path with unclear ownership, inspect and
report it; do not refactor it automatically.

No new global store for redesign convenience.

---

## 8. Backend authority

The backend is authoritative for identity, cart contents, reservation expiry,
seat availability, orders, payment outcome, tickets, ticket status, and QR images.
Do not invent endpoints, fields, or payloads. If a design needs data the API
does not provide, report it (see `docs/API_INTEGRATION.md` §15).

---

## 9. Security-sensitive areas

Changes to any of the following require focused inspection, explicit mention
in the report, and verification — never incidental edits during a visual task:

token storage and session generations · 401/403 invalidation · logout / account
deletion / password change · user-scoped caches · cart session persistence and
expiry · checkout submission guards · CyberSource capture context and WebView ·
BLUE URL validation, WebView navigation policy, terminal-result handling · cart
clearing after payment · QR / ticket / order / PDF handling · push device
registration · deep links and auth return routes · `app.config.js` ATS logic ·
`eas.json` / env configuration · the web `/api` proxy.

See `docs/SECURITY.md`, including open concerns that must not be spread further.

---

## 10. No fake production behavior

Never introduce: fake authentication, fake payment processing or card entry,
client-generated or decorative "functional" QR codes, random or synthetic
order/ticket IDs, mock or hardcoded production data, artificial network delays,
demo toggles, fake notifications, client-side payment success, or UI-only
ticket lifecycle states that contradict backend data.

---

## 11. Localization and RTL — current reality

- **What exists:** Arabic/English localization in `src/i18n/`
  (details in `docs/ARCHITECTURE.md` §15):
  - exactly `en` and `ar`, selected in Settings or signed-out Profile, stored
    independently of authentication in `lfa_locale`; invalid/missing values
    default to English and restoration precedes app content;
  - typed English/Arabic catalogs and internal CLDR plural rules;
  - immediate text/request-language updates; native direction takes effect
    after a user-initiated restart, with startup mismatch/reload-loop guards;
  - central live `Accept-Language: en|ar` for LFA JSON/PDF requests and the
    web proxy, excluding third-party payment pages, scripts and images;
  - locale-aware formatters in `src/lib/format.ts`.
- **Not yet verified:** physical-device RTL, payment-flow testing under
  language switching, and authenticated backend translation support. Header
  tests do not establish translated backend content. Arabic uses the platform
  font; API names/content and provider-owned UI stay authoritative.
- **Rules for new work:**
  - Use this infrastructure for user-facing strings and date, time and money
    formatting. Do not add another localization mechanism or per-screen
    translation hacks.
  - Maintain both catalogs and applicable Arabic plural forms. Use explicit
    direction metadata; never infer behavior from translated text.
  - Prefer logical (start/end) layout. Stadium maps, seat maps and QR codes
    must never mirror.
  - Do not add startup reliance on an `Intl` constructor without confirming the
    native engine (Hermes) supports it, or providing a capability-safe
    fallback. `Intl.PluralRules` is missing on Hermes and once crashed native
    startup.

---

## 12. Task sizing

Work in coherent feature batches (e.g. "Cart + Checkout", "My Tickets").
Split only at a genuine architecture, security, transaction, ownership, or
verification-risk boundary. No micro-phases for ceremony. No unrelated
refactors or speculative cleanup.

---

## 13. Verification expectations

Run what is relevant and report exact results:

- TypeScript: `npx tsc --noEmit`
- Lint: `npx expo lint`
- Tests: `node --test $(git ls-files --cached --others --exclude-standard '*.test.mjs')`
  (Node ≥ 22 type stripping; there is no `npm test` script). The `--others`
  flag includes new, not-yet-tracked test files; plain `git ls-files` would
  silently skip them and give a false green.
- Expo config: `npx expo config` when config/plugins/env change
- Runtime checks for behavior changes, on the platforms affected

Many tests assert on source text (regex over `.tsx` files). A failing source
test after a redesign is a signal to inspect, not something to silence. Do not
delete or weaken tests to pass. Known failures are listed in `docs/STATUS.md`.

Do not report success from source inspection alone when runtime behavior matters.
Label uncertain claims: CONFIRMED / HIGH-CONFIDENCE / POSSIBLE / NOT VERIFIED.

---

## 14. Git

- Never commit, push, amend, or rebase unless the user explicitly instructs it.
- Run `git status` before starting. Pre-existing changes belong to the user:
  do not revert, reformat, stage, or fold them into your work.
- Before proposing a commit: show changed files and the relevant diff, exclude
  unrelated work, list checks run, and disclose anything not verified.
- Do not modify local agent configuration (`.claude/`, `.vscode/`) unless asked.

---

## 15. Agent roles

- **Claude Code** — primary implementation and design-engineering agent.
- **Codex** — independent verifier and targeted inspector; does not redesign
  work it is reviewing to suit its own preference.
- **User** (with ChatGPT as coordinator) — owns requirements, scope, acceptance,
  documentation changes, and commit approval.

Process details: `docs/WORKFLOW.md`.
