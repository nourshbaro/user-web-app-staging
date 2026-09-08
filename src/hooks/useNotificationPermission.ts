import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
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
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await getNotificationPermissionStatus();
      if (id === request.current) setStatus(next);
    } catch {
      // Keep the last OS reading; never substitute a local preference.
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  useEffect(() => {
    const activeRequest = request;

    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void refresh();
        }
      },
    );

    return () => {
      ++activeRequest.current;
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