import type { PropsWithChildren } from "react";
import { useSyncExternalStore } from "react";
import {
  getMaintenanceSnapshot,
  subscribeMaintenance,
} from "@/services/api";
import { UnderConstruction503 } from "@/components/maintenance/UnderConstruction503";

export function MaintenanceGuard({ children }: PropsWithChildren) {
  const maintenance = useSyncExternalStore(
    subscribeMaintenance,
    getMaintenanceSnapshot,
    getMaintenanceSnapshot,
  );

  return maintenance ? <UnderConstruction503 /> : children;
}
