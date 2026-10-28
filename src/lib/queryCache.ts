import { getAppLocale } from "../i18n/locales.ts";
/**
 * Small in-memory read cache for GET resources owned by the service layer
 * (pure module; clock injected for tests). Not a store: services keep the API
 * contract and screens keep their request authorities and UI states.
 *
 * - Per-resource policy: `freshMs` (served without a request) and `maxStaleMs`
 *   (may be shown immediately while a revalidation runs; older entries are not
 *   shown at all).
 * - Identical concurrent reads share one in-flight request.
 * - The latest request for a key wins: an older, slower response never
 *   overwrites a newer one (or an invalidation that happened after it
 *   started), never runs `onAccept`, and is not handed to its caller as data —
 *   the caller receives the authoritative answer instead.
 * - Failures are never cached.
 * - `scope()`: an optional generation (e.g. the user-scoped cache generation);
 *   a response that started under another generation is discarded, and a
 *   generation change drops every entry.
 *
 * Memory only: nothing is persisted.
 */

export type CachePolicy = { freshMs: number; maxStaleMs: number };

export type CacheEntry<T> = { value: T; fetchedAt: number };

type Options = {
  now?: () => number;
  /** Current isolation generation; entries and in-flight reads from another generation are void. */
  scope?: () => number;
};

type ReadOptions<T> = {
  /** Skip the fresh entry and the shared in-flight read (pull-to-refresh, revalidation). */
  force?: boolean;
  /**
   * Runs only when this response is accepted as the key's current value (it is
   * the latest request, nothing invalidated it, same scope). Side effects that
   * depend on "what the backend says now" belong here, never in the fetcher.
   */
  onAccept?: (value: T) => void;
};

export function createQueryCache({ now = Date.now, scope = () => 0 }: Options = {}) {
  const entries = new Map<string, CacheEntry<unknown>>();
  const inFlight = new Map<string, { seq: number; promise: Promise<unknown> }>();
  /** Latest request (or invalidation) sequence per key: only its response may land. */
  const latest = new Map<string, number>();
  let sequence = 0;
  const currentScope = () => `${scope()}:${getAppLocale()}`;
  let generation = currentScope();

  const syncScope = () => {
    const current = currentScope();
    if (current === generation) return;
    generation = current;
    entries.clear();
    inFlight.clear();
    latest.clear();
  };

  const bump = (key: string) => {
    sequence += 1;
    latest.set(key, sequence);
    return sequence;
  };

  function peek<T>(key: string, policy: CachePolicy): CacheEntry<T> | null {
    syncScope();
    const entry = entries.get(key) as CacheEntry<T> | undefined;
    if (!entry || now() - entry.fetchedAt > policy.maxStaleMs) return null;
    return entry;
  }


  function read<T>(key: string, policy: CachePolicy, fetcher: () => Promise<T>, options: ReadOptions<T> = {}): Promise<T> {
    syncScope();
    if (!options.force) {
      const entry = entries.get(key) as CacheEntry<T> | undefined;
      if (entry && now() - entry.fetchedAt <= policy.freshMs) return Promise.resolve(entry.value);
      const pending = inFlight.get(key);
      if (pending) return pending.promise as Promise<T>;
    }
    const seq = bump(key);
    const startedIn = generation;
    const startedAt = now();

    /**
     * A response that lost authority (a newer request started, or the key was
     * invalidated, after it began) never reaches its caller as data: the caller
     * gets the authoritative answer instead — the newer request's result, a
     * newer accepted entry, or (after an invalidation) a fresh read.
     */
    const authoritative = (): Promise<T> | null => {
      const newer = inFlight.get(key);
      if (newer) return newer.promise as Promise<T>;
      const entry = entries.get(key) as CacheEntry<T> | undefined;
      if (entry && entry.fetchedAt >= startedAt) return Promise.resolve(entry.value);
      return null;
    };

    const promise = fetcher().then(
      (value) => {
        syncScope();
        if (inFlight.get(key)?.seq === seq) inFlight.delete(key);
        // Another identity's response: never cached; the caller's own identity guard discards it.
        if (startedIn !== generation) return value;
        if (latest.get(key) === seq) {
          entries.set(key, { value, fetchedAt: now() });
          options.onAccept?.(value);
          return value;
        }
        return authoritative() ?? read(key, policy, fetcher, { onAccept: options.onAccept });
      },
      (error: unknown) => {
        syncScope();
        if (inFlight.get(key)?.seq === seq) inFlight.delete(key);
        // A superseded failure defers to the newer answer when there is one.
        if (startedIn === generation && latest.get(key) !== seq) {
          const answer = authoritative();
          if (answer) return answer;
        }
        throw error;
      },
    );
    inFlight.set(key, { seq, promise });
    return promise;
  }

  /**
   * Drops entries whose key starts with `match` (a string prefix; an exact key
   * is its own prefix) or satisfies it (a predicate). In-flight responses for
   * them will not land; the next read fetches.
   */
  function invalidate(match: string | ((key: string) => boolean)) {
    syncScope();
    const matches = typeof match === "string" ? (key: string) => key.startsWith(match) : match;
    const keys = new Set([...entries.keys(), ...inFlight.keys()]);
    keys.forEach((key) => {
      if (!matches(key)) return;
      entries.delete(key);
      inFlight.delete(key);
      bump(key);
    });
  }

  function clear() {
    entries.clear();
    inFlight.clear();
    latest.clear();
    generation = currentScope();
  }

  return { peek, read, invalidate, clear };
}

export type QueryCache = ReturnType<typeof createQueryCache>;
