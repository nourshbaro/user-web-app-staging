import { decideUpdate, type UpdateDecision } from "@/lib/appUpdatePolicy";
import { currentAppPlatform, loadAppVersionCheck } from "@/services/appUpdate";
import { useEffect, useState } from "react";

const NO_UPDATE: UpdateDecision = { kind: "none" };

/**
 * The update decision for this launch: the backend's answer for this platform
 * and installed version, read once at startup (`loadAppVersionCheck`). Fails
 * open: no answer, a failed or malformed read, or no official store listing
 * → no update state.
 */
export function useAppUpdateDecision(): UpdateDecision {
  const [decision, setDecision] = useState<UpdateDecision>(NO_UPDATE);

  useEffect(() => {
    let active = true;
    loadAppVersionCheck()
      .then((check) => {
        if (!active) return;
        setDecision(decideUpdate({ platform: currentAppPlatform(), check }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return decision;
}
