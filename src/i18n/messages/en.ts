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

  "home.featured.label": "Next match",
  "home.upcoming.title": "Upcoming matches",
  "home.upcoming.viewAll": "All matches",
  "home.upcoming.viewAllHint": "Opens the full match list",
  "home.noUpcoming.title": "No upcoming matches",
  "home.noUpcoming.message": "See all scheduled fixtures in Matches.",

  "match.vs": "vs",
  "match.tickets": "Tickets",
  "match.getTickets": "Get tickets",
  "match.venueTbc": "Stadium TBC",
  "match.status.scheduled": "Scheduled",
  "match.status.unknown": "Status unavailable",
  "match.openHint": "Opens match details and tickets",
  "match.a11y": "{home} vs {away}. {date}, {time}. {venue}. {status}.",
  "match.featured.a11y": "Next match: {home} vs {away}. {date}, {time}. {venue}.",

  "matches.title": "Matches",
  "matches.count.one": "{count} match",
  "matches.count.other": "{count} matches",
  "matches.loading": "Loading matches",
  "matches.error.title": "Could not load matches",
  "matches.empty.title": "No scheduled matches",
  "matches.empty.message": "New fixtures will appear here when they are scheduled. Pull down to refresh.",
  "matches.filteredEmpty.title": "No matches for these filters",
  "matches.filteredEmpty.message": "Try another team, venue or date.",

  "filters.open": "Filters",
  "filters.openActive.one": "Filters, {count} active",
  "filters.openActive.other": "Filters, {count} active",
  "filters.sheetTitle": "Filter matches",
  "filters.team": "Team",
  "filters.venue": "Venue",
  "filters.date": "Match date",
  "filters.allTeams": "All teams",
  "filters.allVenues": "All venues",
  "filters.anyDate": "Any date",
  "filters.clear": "Clear filters",
  "filters.done": "Done",
  "filters.removeChip": "Remove filter: {label}",
  "filters.previousMonth": "Previous month",
  "filters.nextMonth": "Next month",

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
