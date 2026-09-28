# Status — LFA User App

> **Volatile.** This file records current state and goes stale faster than any
> other document. Check it against `git log` / `git status` before relying on
> it. Like all docs here, it is edited only with explicit user authorization
> (`AGENTS.md` §4).

**As of:** 2026-09-28 · Phase 3 final documentation sync

---

## Stage

- ✅ Phase 0 — Baseline / redesign readiness (`e64a150`).
- ✅ Phase 1 — Design Foundations (`3863673`).
- ✅ Phase 2 — Navigation + Home + Match Discovery (`125ee2f`).
- ✅ **Phase 3 — Match Details + Ticket Selection: COMPLETE, pending
  commit.** It was independently reviewed and the focused corrections are
  applied. The changes are uncommitted on `125ee2f`.
- ▶ **Next: Phase 4 — Cart + Checkout** (`docs/WORKFLOW.md` §4).

---

## Validation (current working tree)

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | PASS |
| `npx expo lint` | 0 errors, 5 existing unused-variable warnings |
| Tests (`AGENTS.md` §13 command) | 61 files, **605 / 605 pass** |
| `expo-doctor` | 21/21 |
| `npx expo install --check` | Dependencies up to date |
| Android + iOS Metro export | PASS |
| Web export (server output, incl. `/api`) | PASS |
| Android runtime, GA (EAS dev build `4e8937cd`, Pixel_9a emulator, staging data) | PASS: GA add, update (set 2 → 3) and zero-removal each shown as successful only after the published cart confirmed them; offline Update → "Cart not confirmed", draft kept, Refresh gate → online Refresh → removal completed; staging cart left clean |
| Android runtime, Match Detail (Phase 3 first round) | PASS: open from Home and Matches, hero, map zone → card focus, back with a draft leaves the cart unchanged, 360 dp layout |
| Web runtime (Phase 3 first round) | PASS: Match Detail at 820 and 1280 px, dark theme |
| Reserved-seat runtime | NOT VERIFIED: staging has no seated zone (pure and source tests only) |
| iOS runtime | NOT VERIFIED (Windows environment) |

Exports and runtime come from the Phase 3 correction round. Only docs changed
afterwards.

---

## Phase 3 outcome

- **Match Detail:**
  - a dark hero built from real backend data, reusing the shared match labels
    (strict kickoff, neutral unknown status);
  - skeletons and inline error / not-found states with Retry.
- **Ticket selection:**
  - zone cards that separate GA from reserved seating;
  - a GA stepper;
  - a reserved-seat map with non-colour seat states, zoom, and a selection
    summary;
  - **one confirmation action** (`TransactionBar`).
- **Transactions:**
  - GA add / set / remove / no-op, with the zero-removal path now reachable;
  - success only after a confirmed `CartPublication` (the new `CartContext`
    return contract);
  - honest partial outcomes, and a cart re-read gate after unknown outcomes;
  - reserved seats revalidated against the current seat snapshot, with a
    preflight before any mutation.
- **Accessibility:** seat press targets are sized to neighbour spacing without
  changing geometry.

---

## Deferred (non-blocking) findings

- **Reserved seats:** the runtime path still needs a real seated staging
  fixture before it counts as verified.
- **Seat cache:** the 5-minute cache can age before another user books; the
  backend add stays authoritative.
- **Backend contracts:**
  - the kickoff timezone is unresolved (read as local wall-clock time);
  - there are no structured error codes, so rejections such as ticket limits
    get general messages;
  - live data, results, standings, competitions, favourites and availability
    all need backend support.
- **Arabic / RTL:** no Arabic translation, and `ar` is not enabled. RTL visuals
  and the native direction-transition reload are not runtime-tested.
- **Platforms:**
  - iOS runtime is unverified;
  - a debug dev client can fail on a very slow cold Metro bundle; pre-warming
    the bundle avoids it (tooling only).
- **Checkout accessibility:** a pre-existing concern about nested interactive
  controls (raised in the Phase 3 review; Phase 4 scope).
- **Web (dev):** a "Failed to handle initial notification" toast appears on
  every page in a headless browser. It predates Phase 3.
- **Android (observation):** during the first runtime add of the correction
  round, the JS runtime reloaded in-process once:
  - the reservation itself completed;
  - no JS error was logged;
  - unrelated emulator rotations appeared in the log;
  - it did not recur in any later run, so it is not confirmed as an app
    defect.
- **Legacy screens:** screens not yet redesigned still use the old `muted`
  colour and the `accessibilityState` object; they are migrated as they are
  redesigned.
- **Unused modules:** keep until a scoped cleanup (`CardPaymentPreparationContext`,
  `ProfileDetailModal`, `bluePaymentDiagnostics`, unused push-token helpers,
  `profileService.orders()`).
- **Security and backend** concerns remain tracked in `docs/SECURITY.md` §3 and
  `docs/API_INTEGRATION.md` §14.
