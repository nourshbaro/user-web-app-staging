/**
 * Notification inbox (`GET /portal/notifications`) and unread count
 * (`GET /portal/notifications/unread-count`): parsing and presentation rules.
 * Pure module (no React Native imports).
 *
 * The API is read-only: there is no mark-read mutation, so `isUnread` is only
 * ever what the backend sent. Nothing here (or in the screens) flips it.
 */

export type InboxTeam = {
  id: number | null;
  name: string;
  shortName: string | null;
  logo: string | null;
};

export type InboxMatch = {
  id: number;
  matchDate: string | null;
  kickoffAt: string | null;
  status: string | null;
  homeTeam: InboxTeam | null;
  awayTeam: InboxTeam | null;
};

export type InboxNotification = {
  id: string;
  title: string;
  body: string;
  /** Backend `target_type` ("match", …) or null. Only "match" with a valid match opens a screen. */
  targetType: string | null;
  match: InboxMatch | null;
  /** ISO timestamp, or null when absent / unparseable. */
  sentAt: string | null;
  /** Backend `is_unread === true`; anything else is read. */
  isUnread: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parseTeam(value: unknown): InboxTeam | null {
  const team = record(value);
  const name = team ? text(team.name) : null;
  if (!team || !name) return null;
  return { id: positiveInteger(team.id), name, shortName: text(team.short_name), logo: text(team.logo) };
}

function parseMatch(value: unknown): InboxMatch | null {
  const match = record(value);
  const id = match ? positiveInteger(match.id) : null;
  if (!match || id === null) return null;
  return {
    id,
    matchDate: text(match.match_date),
    kickoffAt: text(match.kickoff_at),
    status: text(match.status),
    homeTeam: parseTeam(match.home_team),
    awayTeam: parseTeam(match.away_team),
  };
}

function parseSentAt(value: unknown): string | null {
  const sentAt = text(value);
  return sentAt && !Number.isNaN(new Date(sentAt).getTime()) ? sentAt : null;
}

/**
 * One item, or null when it cannot be shown honestly: it needs an id and at
 * least a title or a body. Every other field may be missing or null.
 */
export function parseInboxNotification(value: unknown): InboxNotification | null {
  const item = record(value);
  if (!item) return null;
  const id = typeof item.id === "number" && Number.isFinite(item.id) ? String(item.id) : text(item.id);
  const title = text(item.title);
  const body = text(item.body);
  if (!id || (!title && !body)) return null;
  return {
    id,
    title: title ?? body ?? "",
    body: title ? body ?? "" : "",
    targetType: text(item.target_type),
    match: parseMatch(item.match),
    sentAt: parseSentAt(item.sent_at),
    isUnread: item.is_unread === true,
  };
}

/** `{ data: [...] }` (or a bare array). Anything else is a malformed response and throws. */
export function parseInboxNotifications(payload: unknown): InboxNotification[] {
  const data = Array.isArray(payload) ? payload : record(payload)?.data;
  if (!Array.isArray(data)) throw new Error("Invalid notifications response");
  return data.flatMap((item) => {
    const notification = parseInboxNotification(item);
    return notification ? [notification] : [];
  });
}

/** `{ unread_count: n }` with a non-negative integer; anything else throws (never shown as 0). */
export function parseUnreadCount(payload: unknown): number {
  const body = record(payload);
  const count = body ? (body.unread_count ?? record(body.data)?.unread_count) : undefined;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) throw new Error("Invalid unread count response");
  return count;
}

/**
 * The Match Details route a notification may open: only `target_type ===
 * "match"` with a valid match id. Every other notification opens nothing.
 */
export function notificationMatchTarget(notification: InboxNotification): string | null {
  return notification.targetType === "match" && notification.match ? String(notification.match.id) : null;
}

/** Home badge text: hidden at 0, "99+" above 99. */
export function unreadBadgeLabel(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

export type InboxGroupKey = "today" | "yesterday" | "earlier";
export type InboxGroup = { key: InboxGroupKey; items: InboxNotification[] };

function localDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Today / Yesterday / Earlier by the device's local calendar day; no or bad timestamp → Earlier. */
export function inboxGroupKey(sentAt: string | null, now: Date): InboxGroupKey {
  if (!sentAt) return "earlier";
  const sent = new Date(sentAt);
  const days = Math.round((localDay(now) - localDay(sent)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return "earlier";
}

/** Groups in v3 order, newest first inside each; empty groups are omitted. */
export function groupInbox(notifications: readonly InboxNotification[], now: Date): InboxGroup[] {
  const time = (item: InboxNotification) => (item.sentAt ? new Date(item.sentAt).getTime() : -Infinity);
  const sorted = [...notifications].sort((a, b) => time(b) - time(a));
  const order: InboxGroupKey[] = ["today", "yesterday", "earlier"];
  return order
    .map((key) => ({ key, items: sorted.filter((item) => inboxGroupKey(item.sentAt, now) === key) }))
    .filter((group) => group.items.length > 0);
}
