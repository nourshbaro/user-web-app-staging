import { createUnresolvedCardResultStore, createWebStorageBackend } from "@/lib/unresolvedCardResultStore";

/**
 * Web: localStorage only. The app's general `storage` adapter is not used:
 * it falls back to memory when localStorage is unavailable, and a marker
 * kept only in memory must never be reported as saved.
 */
const webLocalStorage = createWebStorageBackend(() => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
});

export const unresolvedCardResultStorage = createUnresolvedCardResultStore({
  primary: webLocalStorage,
  ledger: webLocalStorage,
});
