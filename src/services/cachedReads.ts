import { isPaymentRecoveryVisit } from "@/lib/paymentRecoveryTickets";
import { createQueryCache, type CachePolicy } from "@/lib/queryCache";
import { getUserScopedCacheGeneration, onUserScopedCacheInvalidated } from "@/lib/userScopedCache";
import { profileService } from "@/services/auth";
import { competitionsService } from "@/services/competitions";
import { onLiveTransition } from "@/services/matches";

/**
 * Cached reads over the existing services (memory only). The services keep
 * the API contract and response validation; this layer only decides whether
 * a request is needed (`src/lib/queryCache.ts`). Screens keep their request
 * authorities and loading / error states.
 */

const MINUTE = 60 * 1000;

/**
 * Public competition data. The list changes rarely (30 min); standings move
 * after matches (5 min); competition matches carry live statuses (2 min).
 * A 404 "unavailable" standings answer is a real answer and is cached; errors
 * are never cached. Pull-to-refresh forces a read.
 */
export const COMPETITION_POLICIES = {
  list: { freshMs: 30 * MINUTE, maxStaleMs: 2 * 60 * MINUTE },
  standings: { freshMs: 5 * MINUTE, maxStaleMs: 30 * MINUTE },
  matches: { freshMs: 2 * MINUTE, maxStaleMs: 15 * MINUTE },
} satisfies Record<string, CachePolicy>;

type CompetitionList = Awaited<ReturnType<typeof competitionsService.list>>;
type Standings = Awaited<ReturnType<typeof competitionsService.standings>>;
type CompetitionMatches = Awaited<ReturnType<typeof competitionsService.matches>>;

const competitionCache = createQueryCache();

/**
 * A match entering or leaving play changes competition match statuses and,
 * at full time, standings. Match list items do not say which competition they
 * belong to, so every competition's matches / standings entries are dropped
 * (the competition list is unaffected) and the next read fetches them.
 */
onLiveTransition(() => {
  competitionCache.invalidate((key) => key.startsWith("standings:") || key.startsWith("matches:"));
});

export const competitionReads = {
  list: (force = false) =>
    competitionCache.read("list", COMPETITION_POLICIES.list, () => competitionsService.list(), { force }),
  standings: (id: number, force = false) =>
    competitionCache.read(`standings:${id}`, COMPETITION_POLICIES.standings, () => competitionsService.standings(id), { force }),
  matches: (id: number, force = false) =>
    competitionCache.read(`matches:${id}`, COMPETITION_POLICIES.matches, () => competitionsService.matches(id), { force }),
  peekList: () => competitionCache.peek<CompetitionList>("list", COMPETITION_POLICIES.list),
  peekStandings: (id: number) => competitionCache.peek<Standings>(`standings:${id}`, COMPETITION_POLICIES.standings),
  peekMatches: (id: number) => competitionCache.peek<CompetitionMatches>(`matches:${id}`, COMPETITION_POLICIES.matches),
};

/**
 * The signed-in user's portal reads (My Tickets, Home's ticket card). Scoped
 * to the user-scoped cache generation: an identity change (login, logout,
 * account switch, 401/403 invalidation) drops every entry, and a response
 * that started under the previous identity is discarded. Kept short (the
 * backend owns ticket status and check-in) and invalidated after a successful
 * checkout. Ticket lists can hold backend QR images; they are never persisted.
 */
export const PORTAL_POLICIES = {
  matches: { freshMs: 30 * 1000, maxStaleMs: 10 * MINUTE },
  tickets: { freshMs: 60 * 1000, maxStaleMs: 10 * MINUTE },
} satisfies Record<string, CachePolicy>;

type PortalFilter = "all" | "upcoming" | "past";
type PortalMatches = Awaited<ReturnType<typeof profileService.matches>>;
type PortalTickets = Awaited<ReturnType<typeof profileService.tickets>>;

const portalCache = createQueryCache({ scope: getUserScopedCacheGeneration });
onUserScopedCacheInvalidated(() => portalCache.clear());

export const portalReads = {
  matches: (filter: PortalFilter, force = false) =>
    portalCache.read(`matches:${filter}`, PORTAL_POLICIES.matches, () => profileService.matches(filter), { force }),
  tickets: (matchId: string | number, force = false) =>
    portalCache.read(`tickets:${matchId}`, PORTAL_POLICIES.tickets, () => profileService.tickets(matchId), { force }),
  peekMatches: (filter: PortalFilter) => portalCache.peek<PortalMatches>(`matches:${filter}`, PORTAL_POLICIES.matches),
  peekTickets: (matchId: string | number) => portalCache.peek<PortalTickets>(`tickets:${matchId}`, PORTAL_POLICIES.tickets),
};

/** A purchase (or anything else that changes the user's tickets) makes every portal read stale. */
export function invalidatePortalCache() {
  portalCache.invalidate("");
}

/**
 * Start of a My Tickets visit. A visit from unknown-payment / payment-lock
 * recovery (`PAYMENT_RECOVERY_TICKETS_ROUTE`) drops every portal read first,
 * so the list and ticket details come from the backend, not from a cache
 * filled before the payment. Ordinary visits keep normal caching.
 */
export function beginTicketsVisit(refresh: string | string[] | undefined) {
  if (!isPaymentRecoveryVisit(refresh)) return false;
  invalidatePortalCache();
  return true;
}
