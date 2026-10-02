/**
 * The process-wide maintenance flag (pure: no React Native imports). The one
 * instance lives in `src/services/api.ts`; every backend 503 signals it.
 *
 * Maintenance clears only through `recheck`: a real availability request that
 * the backend answers successfully, with no 503 seen anywhere since that
 * request started. Nothing else may clear it, and clearing it never touches
 * the session, the cart or a payment.
 */

/** What an availability probe observed. */
export type AvailabilityProbeResult = "available" | "maintenance" | "unreachable";

/** "recovered" → the flag was cleared (or was not set); otherwise it is still set. */
export type MaintenanceRecheckResult = "recovered" | "maintenance" | "unreachable";

export function createMaintenanceAuthority() {
  let active = false;
  /** Counts every 503 signal (also while already active), so a recheck can tell if one arrived meanwhile. */
  let signals = 0;
  let pending: Promise<MaintenanceRecheckResult> | null = null;
  const listeners = new Set<() => void>();

  const publish = () => listeners.forEach((listener) => listener());

  return {
    /** A backend 503 was observed. */
    signal() {
      signals += 1;
      if (active) return;
      active = true;
      publish();
    },
    isActive() {
      return active;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * Asks the backend whether the service is available again. Single-flight:
     * repeated calls while one is pending share it, so taps cannot stack
     * requests.
     */
    recheck(probe: () => Promise<AvailabilityProbeResult>): Promise<MaintenanceRecheckResult> {
      if (!active) return Promise.resolve("recovered");
      if (pending) return pending;
      const signalsAtStart = signals;
      const run = (async (): Promise<MaintenanceRecheckResult> => {
        let result: AvailabilityProbeResult;
        try {
          result = await probe();
        } catch {
          result = "unreachable";
        }
        if (result !== "available") return result;
        // A 503 from any request after this probe started outranks its success.
        if (signals !== signalsAtStart) return "maintenance";
        if (active) {
          active = false;
          publish();
        }
        return "recovered";
      })();
      pending = run;
      void run.finally(() => {
        if (pending === run) pending = null;
      });
      return run;
    },
  };
}
