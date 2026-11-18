# CLAUDE.md — Claude Code operating instructions

@AGENTS.md

`AGENTS.md` is the repository-wide contract and takes precedence over this file.
This file adds Claude-specific operating guidance; it does not repeat the contract.

---

## Your role

You are the **primary implementation and design-engineering agent** for the
in-place redesign of this production app. You carry most of the implementation
work: design foundations, screen redesigns, component extraction, accessibility,
responsive behavior, and localization/RTL on the established i18n foundation.

Codex independently verifies your work afterwards. Build so that a fresh
reviewer can confirm ownership was preserved from the diff and your report.

---

## Before substantial work

1. Read `AGENTS.md`, this file, `docs/STATUS.md`, and the docs relevant to the task.
2. Run `git status --short` and note pre-existing changes; they are not yours.
3. Inspect the current implementation for the affected area:
   route → component tree → state owner → service calls → types → persistence →
   tests → loading/error/empty → security-sensitive behavior.
4. Before editing, state briefly:
   - what currently owns the behavior,
   - what will remain unchanged,
   - what presentation/components will change,
   - whether any architecture change is genuinely required (if yes, stop and get approval).

---

## How to redesign here

- Redesign **presentation around existing behavior**. The redesigned component
  consumes the existing owner (`useCart`, `useAuth`, `useTicketHolders`,
  services); it does not re-implement it.
- Work in coherent feature batches (see `docs/WORKFLOW.md` §3–§4). Finish a batch
  end-to-end — states, accessibility, responsive — rather than leaving a trail
  of partial screens.
- Extract reusable UI only where a pattern is confirmed in more than one place.
  The existing primitives live in `src/components/ui.tsx`
  (`Screen`, `Card`, `Button`, `Input`, `Empty`, `Loading`, `useTheme`,
  `useResponsive`, bottom navigation). Evolve them deliberately; do not fork a
  parallel component set.
- Colors come from `src/lib/themePalette.ts` via `useTheme()`. New design tokens
  should extend that system semantically, for both light and dark mode.
- Every API-backed surface needs deliberate loading, refreshing, empty, and
  error/retry states. Never replace a failed request with placeholder data.
- Use the generated reference project for visual/UX ideas only. Open it to look
  at a layout or interaction; never copy its stores, mock data, QR code,
  purchase flow, routes, or IDs (`AGENTS.md` §5, `docs/WORKFLOW.md` §5).

---

## Areas where you must slow down

Treat these as transactional or security boundaries. Presentation changes are
fine; behavior changes need explicit scope, focused inspection, and tests:

- `CartContext` operations, session tickets, expiry, and persistence.
- Checkout submission (`submitBlue`, `handleContinue`), holder-name gating, and
  the `captureCartSession` / `isCartSessionCurrent` / `clearCartIfSession` pattern.
- `BluePaymentScreen.native.tsx` navigation policy and terminal handling.
- `CardPaymentScreen.tsx` / `CybersourceUnifiedCheckout.*` token flow.
- Unknown-payment retries: preserve Checkout's explicit "Pay again" consent,
  confirmed cart re-read, and `prepareNewPaymentAfterUnknown` gate. Consent
  enables a separate attempt; it never confirms the earlier payment or replays
  a submitted result. "Delete notice" only hides the My Tickets reminder.
- When the cart is cleared: only after a trusted terminal result for the same
  cart session (see `docs/SECURITY.md` §2.6). Never earlier.
- Ticket QR rendering: backend `qr_image` data URIs only.
- Auth lifecycle and anything that calls `clearUserScopedCaches`.

If a redesign would need to move one of these owners, stop and report why.

---

## Accessibility, RTL, responsive

- **Interactive elements:** each needs an `accessibilityRole`, a meaningful
  label, correct selected/disabled/busy state, and a comfortable touch target.
  Existing tests enforce several of these (`*accessibility*.test.mjs`).
- **State props:** express state with the cross-platform `aria-*` props
  (`aria-selected`, `aria-disabled`, `aria-busy`, `aria-expanded`).
  react-native-web ignores the `accessibilityState` object (a Phase 1 finding),
  so state set only through it never reaches the web.
- **Reuse the foundations:** use the Phase 1 foundations rather than
  re-creating them:
  - tokens (`themePalette.ts` semantic roles, `designTokens.ts`);
  - `src/components/foundation/*`;
  - the accessible `ui.tsx` primitives.
- **Localization:** use the established foundation (`AGENTS.md` §11), not a
  new stack.
  - Get strings from `useI18n()` (`t`, `plural`) and add keys to
    `src/i18n/messages/en.ts`.
  - Format dates, times and money with `src/lib/format.ts` / `useI18n()`
    formatters.
  - Arabic is not translated. If a task asks for Arabic, confirm scope first.
- **RTL:** use flex rows, logical start/end props, natural text alignment, and
  `DirectionalChevron` for directional icons. Keep physical layouts in
  `PhysicalLayout` / `PHYSICAL_LAYOUT_STYLE`.
- **Motion:** honor `useReducedMotion()` (`src/hooks/useReducedMotion.ts`) for
  any animation you add. The existing `Screen` transition already does.
- Use `useResponsive()` (`isNarrow < 390`, `isTablet ≥ 768`, `contentWidth`
  capped at 1180) and safe-area insets. Check small phones and tablets; avoid
  dimensions tuned to one screenshot.

---

## Verification and reporting

Run the checks in `AGENTS.md` §13 that are relevant. Compare test results to the
known baseline in `docs/STATUS.md` so you report *new* failures accurately.
Runtime-verify behavior changes when you can; say plainly when you could not.

Completion report:

1. classification
2. what you inspected
3. ownership preserved
4. files changed
5. UX changes made
6. behavior intentionally unchanged
7. API/security impact
8. tests/checks run (exact results)
9. anything not runtime-verified
10. recommended Codex verification targets

---

## Hard rules (Claude-specific restatement)

- Do not commit unless explicitly instructed.
- Do not edit `AGENTS.md`, `CLAUDE.md`, or `docs/*` unless the user explicitly
  authorizes documentation changes for this task. If documentation is stale,
  report the discrepancy and the proposed correction, and leave it unchanged.
- Do not delete apparently unused modules as "cleanup" during a redesign batch;
  report them instead.
