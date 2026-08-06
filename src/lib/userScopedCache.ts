type ClearableUserScopedCache = {
  clear: () => void;
};

const caches = new Set<ClearableUserScopedCache>();
const invalidationListeners = new Set<() => void>();
let generation = 0;

export class UserScopedCache<T> {
  private entry: { ownerKey: string; value: T } | null = null;

  constructor() {
    caches.add(this);
  }

  get(ownerKey: string | null): T | null {
    if (!ownerKey || this.entry?.ownerKey !== ownerKey) return null;
    return this.entry.value;
  }

  set(ownerKey: string | null, value: T): boolean {
    if (!ownerKey) return false;
    this.entry = { ownerKey, value };
    return true;
  }

  clear() {
    this.entry = null;
  }
}

export function clearUserScopedCaches() {
  generation += 1;
  caches.forEach((cache) => cache.clear());
  invalidationListeners.forEach((listener) => listener());
}

export function getUserScopedCacheGeneration() {
  return generation;
}

export function onUserScopedCacheInvalidated(listener: () => void) {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}
