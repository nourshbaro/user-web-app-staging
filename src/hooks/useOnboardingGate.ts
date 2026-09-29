import { getInitialNotificationData, getNotificationPermissionStatus, pushRuntimeSupported } from "@/lib/notifications";
import { notificationMatchId } from "@/lib/notificationTarget";
import {
  decideLaunchOnboarding,
  isNativePlatform,
  ONBOARDING_STORAGE_KEY,
  serializeOnboardingCompleted,
  shouldYieldToNavigation,
} from "@/lib/onboarding";
import { storage } from "@/lib/storage";
import { useNavigationContainerRef } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

type GateState = "deciding" | "hidden" | "visible";

export type OnboardingGate = {
  /** Still resolving the launch (native splash stays up meanwhile). */
  deciding: boolean;
  visible: boolean;
  offerNotifications: boolean;
  /** Onboarding finished: hide it and persist the versioned flag. */
  complete: () => void;
};

/**
 * Decides once per launch whether to show first-run onboarding. It never
 * navigates: it only overlays Home. The decision waits for the navigation
 * container's resolved initial state and the launch notification
 * (`decideLaunchOnboarding`), so a direct entry never shows onboarding, not
 * even briefly. Afterwards it steps aside (without marking itself completed)
 * as soon as anything navigates away from Home.
 */
export function useOnboardingGate({ ready, isAuthenticated, pathname }: { ready: boolean; isAuthenticated: boolean; pathname: string }): OnboardingGate {
  const native = isNativePlatform(Platform.OS);
  const navigationRef = useNavigationContainerRef();
  const [state, setState] = useState<GateState>(native ? "deciding" : "hidden");
  const [offerNotifications, setOfferNotifications] = useState(false);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!native || !ready || startedRef.current) return;
    startedRef.current = true;

    void decideLaunchOnboarding({
      platform: Platform.OS,
      isAuthenticated,
      pushRuntimeSupported,
      readStoredFlag: () => storage.get(ONBOARDING_STORAGE_KEY),
      // Read-only use of the container ref: readiness and the focused route.
      navigation: navigationRef,
      // Read-only: the notification's routing stays in the root layout.
      readLaunchNotificationTarget: async () => notificationMatchId(await getInitialNotificationData()),
      readPermission: getNotificationPermissionStatus,
    }).then((decision) => {
      // A signed-in (existing) user is never sent through onboarding later either.
      if (!decision.show && decision.reason === "existing-user") {
        void storage.set(ONBOARDING_STORAGE_KEY, serializeOnboardingCompleted()).catch(() => {});
      }
      if (!mountedRef.current) return;
      if (decision.show) setOfferNotifications(decision.offerNotifications);
      setState(decision.show ? "visible" : "hidden");
    }, () => {
      // Never trap the app on an unexpected failure.
      if (mountedRef.current) setState("hidden");
    });
  }, [isAuthenticated, native, navigationRef, ready]);

  // Navigation away from Home wins over onboarding for this launch (not marked completed).
  if (state === "visible" && shouldYieldToNavigation(pathname)) {
    setState("hidden");
  }

  const complete = useCallback(() => {
    setState("hidden");
    void storage.set(ONBOARDING_STORAGE_KEY, serializeOnboardingCompleted()).catch(() => {});
  }, []);

  return { deciding: state === "deciding", visible: state === "visible", offerNotifications, complete };
}
