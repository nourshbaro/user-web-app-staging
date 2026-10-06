import { parseInboxNotifications, parseUnreadCount } from "@/lib/notificationInbox";
import { apiRequest } from "@/services/api";

/**
 * The signed-in user's notification inbox (portal API, through `apiRequest`:
 * auth headers, 401/403 invalidation, maintenance, timeouts). Read-only:
 * the API has no mark-read mutation. Screens read it through `notificationReads`
 * (`src/services/cachedReads.ts`), never directly.
 */
export const notificationInboxService = {
  async list() {
    return parseInboxNotifications(await apiRequest<unknown>("/portal/notifications"));
  },
  async unreadCount() {
    return parseUnreadCount(await apiRequest<unknown>("/portal/notifications/unread-count"));
  },
};
