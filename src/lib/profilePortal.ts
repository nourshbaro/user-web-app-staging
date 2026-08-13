export type PaginatedProfileResult<T> = {
  items: T[];
  total: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizePaginatedProfileResult<T>(
  payload: unknown,
): PaginatedProfileResult<T> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return { items: [], total: 0 };
  }

  const items = [...payload.data] as T[];
  const meta = isRecord(payload.meta) ? payload.meta : null;
  const candidateTotal = meta?.total;
  const total =
    typeof candidateTotal === "number"
    && Number.isInteger(candidateTotal)
    && candidateTotal >= 0
      ? candidateTotal
      : items.length;

  return { items, total };
}

export function getTicketOrderReference(ticket: unknown) {
  if (!isRecord(ticket)) return null;
  return readNonEmptyString(ticket.order_code);
}

export function getTicketMatchName(ticket: unknown) {
  if (!isRecord(ticket) || !isRecord(ticket.match)) return null;

  const homeTeam = readNonEmptyString(ticket.match.home_team);
  const awayTeam = readNonEmptyString(ticket.match.away_team);
  if (!homeTeam || !awayTeam) return null;

  return `${homeTeam} vs ${awayTeam}`;
}