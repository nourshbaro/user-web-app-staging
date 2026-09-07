import { router } from "expo-router";

type NotificationData = Record<string, unknown>;

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

export function handleNotificationNavigation(
  data: NotificationData,
) {
  const matchId = textValue(data.match_id);

  if (matchId) {
    router.push({
      pathname: "/match/[id]",
      params: {
        id: matchId,
      },
    });
  }
}