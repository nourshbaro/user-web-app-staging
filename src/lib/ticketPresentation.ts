/**
 * My Tickets presentation rules. Pure module (no React Native imports).
 *
 * The backend owns every ticket fact: which matches are upcoming or past
 * (`/portal/matches?filter=` and `is_upcoming`), each ticket's `status`, its
 * `checked_in_at`, and the QR image. Nothing here derives validity from the
 * kickoff date or the look of a ticket.
 */

export type TicketFilter = "all" | "upcoming" | "past";

export const TICKET_FILTERS: readonly TicketFilter[] = ["all", "upcoming", "past"];

/**
 * Visual states v3 draws. Only `valid`, `used`, `expired` and `cancelled`
 * carry meaning, and each needs backend evidence; anything else is `other`
 * (shown with the backend's own label, no invented meaning).
 */
export type TicketVisualState = "valid" | "used" | "expired" | "cancelled" | "other";

export type TicketStatusInput = { status: string; checked_in_at: string | null };

function normalized(status: string) {
  return status.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Backend status → v3 state.
 * - "valid" is valid, unless `checked_in_at` records an entry scan → used
 *   (check-in evidence on an otherwise valid ticket).
 * - "used" / "checked_in" → used; "expired" → expired;
 *   "cancelled" / "canceled" → cancelled (only when the backend says so).
 * - Any other status stays `other`, even when `checked_in_at` is set: a
 *   stronger, unknown backend status is never overridden by the timestamp.
 */
export function ticketVisualState({ status, checked_in_at }: TicketStatusInput): TicketVisualState {
  const value = normalized(status ?? "");
  const checkedIn = typeof checked_in_at === "string" && checked_in_at.trim() !== "";
  if (value === "valid") return checkedIn ? "used" : "valid";
  if (value === "used" || value === "checked_in") return "used";
  if (value === "expired") return "expired";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return "other";
}

/** A human label for an unrecognised backend status ("pending_transfer" → "Pending transfer"). */
export function rawStatusLabel(status: string) {
  const words = (status ?? "").trim().replace(/[_-]+/g, " ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : "";
}

/** Only a scannable state presents the QR at full strength. */
export function ticketIsScannable(state: TicketVisualState) {
  return state === "valid";
}

/**
 * The QR shown is the backend's own image and nothing else: a bounded raster
 * base64 data URI (PNG / JPEG / WebP) from `qr_image` — the same allowlist the
 * LFA web client applies to this API (`user-web` `lib/ticketQr.ts`). SVG,
 * http(s) URLs, storage paths and any other scheme are rejected: no other
 * representation is established by the contract. No QR is ever generated
 * from the ticket code or any other field; anything else shows "QR unavailable".
 */
const QR_DATA_URI = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;
export const QR_DATA_URI_MAX_LENGTH = 512_000;

export function ticketQrSource(ticket: { qr_image?: unknown } | null | undefined) {
  const value = ticket?.qr_image;
  return typeof value === "string" && value.length <= QR_DATA_URI_MAX_LENGTH && QR_DATA_URI.test(value) ? value : null;
}

/**
 * Completes listed tickets that have no usable backend QR from their own
 * detail endpoint (`GET /portal/tickets/{ticket_code}`). Only the detail's
 * `qr_image` is taken, and only when it passes `ticketQrSource`; every other
 * listed (validated) field is kept. A ticket whose detail has no usable QR
 * stays without one ("QR unavailable"). A failed detail request rejects, as
 * before, so the screen shows its error / retry state.
 */
export async function withBackendQrs<T extends { ticket_code: string; qr_image?: string | null }>(
  tickets: readonly T[],
  fetchDetail: (ticketCode: string) => Promise<unknown>,
  isCurrent: () => boolean,
): Promise<T[]> {
  return Promise.all(
    tickets.map(async (ticket) => {
      if (ticketQrSource(ticket) || !ticket.ticket_code || !isCurrent()) return ticket;
      const detail = await fetchDetail(ticket.ticket_code);
      const qr = ticketQrSource(detail && typeof detail === "object" ? (detail as { qr_image?: unknown }) : null);
      return qr ? { ...ticket, qr_image: qr } : ticket;
    }),
  );
}

/** Seat facts from the backend seat record, when present (never invented). */
export function ticketSeatFacts(seat: Record<string, unknown> | null | undefined) {
  if (!seat || typeof seat !== "object") return { row: null as string | null, seat: null as string | null };
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
  return { row: text(seat.row), seat: text(seat.number) ?? text(seat.label) };
}

export type PortalMatchLike = { match_id: number; is_upcoming: boolean };

export type TicketListSection<M> = { key: "upcoming" | "past" | "all"; items: M[] };

/**
 * List sections. "All" is split by the backend's `is_upcoming` (v3 draws
 * Upcoming / Past headings); the Upcoming and Past filters are one section,
 * exactly as the backend returned them.
 */
export function ticketListSections<M extends PortalMatchLike>(filter: TicketFilter, matches: readonly M[]): TicketListSection<M>[] {
  if (filter !== "all") return matches.length ? [{ key: filter, items: [...matches] }] : [];
  const upcoming = matches.filter((match) => match.is_upcoming);
  const past = matches.filter((match) => !match.is_upcoming);
  return [
    ...(upcoming.length ? [{ key: "upcoming" as const, items: upcoming }] : []),
    ...(past.length ? [{ key: "past" as const, items: past }] : []),
  ];
}

export type TicketListView = "loading" | "error" | "empty" | "list";

/** Which list state renders. A failed request never shows stale or empty data as if it were real. */
export function ticketListView({ loading, error, count }: { loading: boolean; error: boolean; count: number }): TicketListView {
  if (loading) return "loading";
  if (error) return "error";
  return count ? "list" : "empty";
}
