import { decideUpdate, type UpdateDecision } from "@/lib/appUpdatePolicy";
import { currentAppPlatform, installedAppVersion, loadAppUpdatePolicy } from "@/services/appUpdate";
import { useEffect, useState } from "react";

const NO_UPDATE: UpdateDecision = { kind: "none" };

/**
 * The update decision for this launch: the backend policy (read once at
 * startup) against the installed version. Fails open: no policy, a failed
 * read or a malformed version → no update state.
 */
export function useAppUpdateDecision(): UpdateDecision {
  const [decision, setDecision] = useState<UpdateDecision>(NO_UPDATE);

  useEffect(() => {
    let active = true;
    loadAppUpdatePolicy()
      .then((policy) => {
        if (!active) return;
        setDecision(decideUpdate({ platform: currentAppPlatform(), installedVersion: installedAppVersion(), policy }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return decision;
}
