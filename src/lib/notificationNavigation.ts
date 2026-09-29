import { router } from "expo-router";
import { notificationMatchId, type NotificationData } from "@/lib/notificationTarget";

export function handleNotificationNavigation(
  data: NotificationData,
) {
  const matchId = notificationMatchId(data);

  if (matchId) {
    router.push({
      pathname: "/match/[id]",
      params: {
        id: matchId,
      },
    });
  }
}
