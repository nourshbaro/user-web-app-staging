/**
 * English catalog — the complete, default locale.
 *
 * Conventions:
 * - Flat, dot-namespaced keys: `<area>.<purpose>` (e.g. `state.error.title`).
 * - Interpolation uses `{name}` placeholders.
 * - Plurals use `.one` / `.other` suffixes (plus `.zero/.two/.few/.many`
 *   where a language needs them); callers use `plural(key, count)`.
 * - Screens not yet migrated still hold inline English; they move here as
 *   each redesign phase touches them.
 */
export const en = {
  "common.loading": "Loading",
  "common.retry": "Try again",
  "common.close": "Close",
  "common.back": "Back",

  "nav.primary": "Main navigation",
  "nav.home": "Home",
  "nav.tournament": "Tournament",
  "nav.matches": "Matches",
  "nav.tickets": "My Tickets",
  "nav.profile": "Profile",

  "state.error.title": "Something went wrong",
  "state.error.message": "Please check your connection and try again.",
  "state.empty.title": "Nothing here yet",
  "state.unavailable.title": "Not available",

  "tournament.comingSoon.title": "Coming Soon",
  "tournament.comingSoon.message": "Tournament information will be available here.",

  "transaction.total": "Total",
  "transaction.ticketCount.one": "{count} ticket",
  "transaction.ticketCount.other": "{count} tickets",

  "ticket.qr.label": "Ticket QR code",

  "direction.restart.title": "Restart required",
  "direction.restart.message": "Close LFA Tickets completely and open it again to finish applying your language settings.",
  "direction.restart.action": "Restart now",
} as const;

export type MessageKey = keyof typeof en;
export type MessageCatalog = Partial<Record<MessageKey, string>>;
