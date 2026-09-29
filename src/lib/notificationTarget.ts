/**
 * Where a notification's data routes. Pure module (no React Native imports),
 * shared by the tap router (`notificationNavigation.ts`) and the onboarding
 * launch check, so both agree on which notifications open a screen.
 */
export type NotificationData = Record<string, unknown>;

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

/** The match a notification opens (`/match/[id]`), or null when it routes nowhere. */
export function notificationMatchId(data: NotificationData | null | undefined): string | null {
  return data ? textValue(data.match_id) : null;
}
