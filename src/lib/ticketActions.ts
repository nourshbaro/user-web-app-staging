type PortalRecord = Record<string, unknown>;
function record(value: unknown): PortalRecord | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as PortalRecord : null; }
function identifier(value: unknown) { if (typeof value === "number" && Number.isFinite(value)) return String(value); if (typeof value === "string" && value.trim()) return value.trim(); return null; }
function matchIdentifier(value: unknown) { const item = record(value); if (!item) return null; return identifier(record(item.match)?.id) ?? identifier(item.match_id); }
export function resolveOrderDetailIdentifier(order: unknown) { return identifier(record(order)?.order_number); }
export function normalizeOrderIdentifier(orderId: string) { return orderId.startsWith("ORD-") ? orderId.slice(4) : orderId; }
export function profilePdfOrderIdentifier(order: unknown) { const item = record(order); if (!item) return null; for (const key of ["order_number", "order_code", "code", "reference", "id"] as const) { const result = identifier(item[key]); if (result) return result; } return null; }
export function resolveTicketMatchId(ticket: unknown, order: unknown) { const direct = matchIdentifier(ticket) ?? matchIdentifier(order); if (direct) return direct; const orderRecord = record(order); for (const collection of [orderRecord?.items, orderRecord?.tickets]) { if (!Array.isArray(collection)) continue; for (const item of collection) { const nested = matchIdentifier(item); if (nested) return nested; } } return null; }
