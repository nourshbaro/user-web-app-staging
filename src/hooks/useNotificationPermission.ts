import { useCallback, useEffect, useState } from "react";
import { AppState, Linking } from "react-native";

import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/lib/notifications";

export function useNotificationPermission() {
  const [status, setStatus] =
    useState<NotificationPermissionState>("undetermined");

  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getNotificationPermissionStatus();
      setStatus(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void refresh();
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    setLoading(true);

    try {
      const next = await requestNotificationPermission();

      setStatus(next);

      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  const openSettings = useCallback(async () => {
    await Linking.openSettings();
  }, []);

  return {
    status,
    loading,
    refresh,
    requestPermission,
    openSettings,
  };
}