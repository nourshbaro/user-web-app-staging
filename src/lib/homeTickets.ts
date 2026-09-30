/**
 * Home "My Tickets" card (LFA Screen v3). Pure module (no React Native imports).
 *
 * The card shows the signed-in user's next match that they hold tickets for,
 * from the backend portal (`GET /portal/matches?filter=upcoming`). Only real
 * portal rows are used: an upcoming match with at least one ticket. Nothing is
 * counted, derived or invented on the device.
 */
import type { PortalMatch } from "@/types";

function kickoff(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** The earliest upcoming portal match with tickets, or null. Unparseable kickoffs sort last. */
export function selectNextTicketMatch(items: readonly PortalMatch[]): PortalMatch | null {
  const eligible = items.filter((match) => match.is_upcoming && match.ticket_count > 0);
  if (!eligible.length) return null;
  return [...eligible]
    .map((match, index) => ({ match, index, time: kickoff(match.kickoff_at) }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return a.time - b.time || a.index - b.index;
    })[0].match;
}
