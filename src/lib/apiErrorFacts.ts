import { ApiError, ApiTransportError } from "@/services/api";

/** Transport/status facts of a failed request, for the pure error classifiers. */
export function errorFacts(error: unknown): {
  status: number | null;
  transport: "network" | "timeout" | null;
} {
  if (error instanceof ApiTransportError) return { status: null, transport: error.category };
  if (error instanceof ApiError) return { status: error.status, transport: null };
  return { status: null, transport: null };
}
