import { MaintenanceScreen } from "@/components/maintenance/MaintenanceScreen";
import { UpdatePromptDialog } from "@/components/maintenance/UpdatePromptDialog";
import { useAppUpdateDecision } from "@/hooks/useAppUpdateDecision";
import { systemState, updateDismissKey } from "@/lib/appUpdatePolicy";
import type { MaintenanceRecheckResult } from "@/lib/maintenanceAuthority";
import {
  getSystemStatePreview,
  setSystemStatePreview,
  subscribeSystemStatePreview,
  systemStatePreviewFromUrl,
} from "@/lib/systemStatePreview";
import { getMaintenanceSnapshot, probeBackendAvailability, recheckMaintenance, subscribeMaintenance } from "@/services/api";
import { type PropsWithChildren, useEffect, useState, useSyncExternalStore } from "react";
import { Linking } from "react-native";

/**
 * The one owner of what the system states render, in the fixed priority
 * maintenance → required update → optional update → app (`systemState`).
 * Exactly one state shows; they never stack.
 *
 * - Maintenance replaces the navigator (the providers above it, so the
 *   session, cart and payments, stay mounted and untouched).
 * - An update prompt is a modal over the running app.
 *
 * In development builds only, a preview (`systemStatePreview.ts`) can force a
 * state for visual checks; production ignores it.
 */
export function SystemStateGate({ children }: PropsWithChildren) {
  const maintenance = useSyncExternalStore(subscribeMaintenance, getMaintenanceSnapshot, getMaintenanceSnapshot);
  const preview = useSyncExternalStore(subscribeSystemStatePreview, getSystemStatePreview, getSystemStatePreview);
  const update = useAppUpdateDecision();
  const [dismissedLatestVersion, setDismissedLatestVersion] = useState<string | null>(null);
  useSystemStatePreviewLinks();

  const previewing = __DEV__ && preview !== null;
  const state = previewing ? preview : systemState({ update, maintenance, dismissedLatestVersion });

  if (state === "maintenance") {
    const retry = previewing ? retryPreviewMaintenance : recheckMaintenance;
    return <MaintenanceScreen onRetry={retry} />;
  }

  let prompt = null;
  if (state === "updateRequired" || state === "updateAvailable") {
    const kind = state === "updateRequired" ? "required" : "available";
    // The preview carries nothing invented: no store URL, version or notes.
    const details = previewing || update.kind === "none"
      ? { storeUrl: null, latestVersion: null, releaseNotes: [] }
      : { storeUrl: update.storeUrl, latestVersion: update.latestVersion, releaseNotes: update.releaseNotes };
    const dismiss = kind === "required"
      ? undefined
      : previewing
        ? () => setSystemStatePreview(null, __DEV__)
        : () => setDismissedLatestVersion(updateDismissKey(update));
    // Keyed per prompt: a different prompt is a fresh dialog (state, entrance).
    prompt = <UpdatePromptDialog key={`${kind}:${details.latestVersion ?? ""}`} kind={kind} {...details} onDismiss={dismiss} />;
  }

  return (
    <>
      {children}
      {prompt}
    </>
  );
}

/** Preview "Try again": the same real availability probe; ends the preview only when the backend answers. */
async function retryPreviewMaintenance(): Promise<MaintenanceRecheckResult> {
  const result = await probeBackendAvailability();
  if (result !== "available") return result;
  setSystemStatePreview(null, __DEV__);
  return "recovered";
}

/** Development builds only: `lfa-app:///?systemStatePreview=<state|normal>` switches the preview. */
function useSystemStatePreviewLinks() {
  useEffect(() => {
    if (!__DEV__) return;
    const apply = (url: string | null) => {
      const next = systemStatePreviewFromUrl(url);
      if (next !== undefined) setSystemStatePreview(next, __DEV__);
    };
    void Linking.getInitialURL().then(apply).catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) => apply(url));
    return () => subscription.remove();
  }, []);
}
