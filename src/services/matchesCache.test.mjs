import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const transpile = (source) =>
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "(\.\.\/i18n\/[^"\n]+\.ts)"/g, (_, path) => `from ${JSON.stringify(new URL(path, import.meta.url).href)}`);
const toModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const queryCacheSource = transpile(await read("../lib/queryCache.ts"));
const matchesSource = transpile(await read("./matches.ts"));
let instance = 0;

/** A fresh matches service with a controllable clock and a fake API keyed by path. */
async function load() {
  instance += 1;
  const key = `__matchesCache_${instance}`;
  const state = { now: 1_000_000, calls: [], responses: {} };
  globalThis[key] = state;
  // The service's cache reads the injected clock (Date.now is only its default).
  const queryCacheUrl = toModuleUrl(
    queryCacheSource.replace("now = Date.now", `now = () => globalThis[${JSON.stringify(key)}].now`),
  );
  const apiUrl = toModuleUrl(`
    export async function apiRequest(path) {
      const state = globalThis[${JSON.stringify(key)}];
      state.calls.push(path);
      const answer = state.responses[path];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer() : answer;
    }
    export function unwrapData(payload) {
      return payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
    }
  `);
  const source = matchesSource
    .replace('from "@/lib/queryCache"', `from ${JSON.stringify(queryCacheUrl)}`)
    .replace('from "@/services/api"', `from ${JSON.stringify(apiUrl)}`);
  const service = await import(toModuleUrl(`${source}\n// ${key}`));
  return { ...service, state, advance: (ms) => { state.now += ms; } };
}

const count = (state, path) => state.calls.filter((call) => call === path).length;

test("Matches → Tickets → Matches: a fresh scheduled list is reused (no second request)", async () => {
  const m = await load();
  m.state.responses["/matches/scheduled"] = [{ id: 1 }];
  await m.matchesService.list({});
  m.advance(60 * 1000);
  await m.matchesService.list({});
  assert.equal(count(m.state, "/matches/scheduled"), 1);
  assert.deepEqual(m.matchesService.peekList({}).value, [{ id: 1 }]);
});

test("filters, status and date are part of the key", async () => {
  const m = await load();
  for (const path of ["/matches/scheduled", "/matches/scheduled?status=live", "/matches/scheduled?team=nejmeh&status=completed", "/matches/scheduled?date=2026-10-22"]) {
    m.state.responses[path] = [{ path }];
  }
  await m.matchesService.list({});
  await m.matchesService.list({ status: "live" });
  await m.matchesService.list({ team: "nejmeh", status: "completed" });
  await m.matchesService.list({ date: "2026-10-22" });
  assert.equal(m.state.calls.length, 4);
  assert.deepEqual(await m.matchesService.list({ status: "live" }), [{ path: "/matches/scheduled?status=live" }]);
  assert.equal(m.state.calls.length, 4);
});

test("the live list is only fresh for 30 s; the scheduled list for 5 min", async () => {
  const m = await load();
  m.state.responses["/matches/scheduled"] = [];
  m.state.responses["/matches/scheduled?status=live"] = [];
  await m.matchesService.list({});
  await m.matchesService.list({ status: "live" });
  m.advance(31 * 1000);
  await m.matchesService.list({});
  await m.matchesService.list({ status: "live" });
  assert.equal(count(m.state, "/matches/scheduled"), 1);
  assert.equal(count(m.state, "/matches/scheduled?status=live"), 2);
  m.advance(5 * 60 * 1000);
  await m.matchesService.list({});
  assert.equal(count(m.state, "/matches/scheduled"), 2);
});

test("focus revalidation reuses a fresh live list; a Live interval tick (forced) always reads", async () => {
  const m = await load();
  m.state.responses["/matches/scheduled?status=live"] = [];
  await m.matchesService.list({ status: "live" });
  m.advance(10 * 1000);
  await m.matchesService.list({ status: "live" }); // back from Match Details
  assert.equal(m.state.calls.length, 1, "a re-focus seconds later reuses the read");
  m.advance(19 * 1000);
  await m.matchesService.list({ status: "live" }, true); // interval tick just under 30 s after the read
  assert.equal(m.state.calls.length, 2, "polling is never skipped");
  m.advance(31 * 1000);
  await m.matchesService.list({ status: "live" }); // focus after the live window
  assert.equal(m.state.calls.length, 3);
});

/** Fills every list a transition can make obsolete, plus two details. */
async function primeLists(m, live) {
  const responses = {
    "/matches/scheduled": [{ id: 5 }, { id: 6 }],
    "/matches/scheduled?status=completed": [{ id: 4 }],
    "/matches/scheduled?team=nejmeh": [{ id: 5 }],
    "/matches/scheduled?team=nejmeh&status=live": live,
    "/matches/single/5": { id: 5, status: live.length ? "live" : "scheduled" },
    "/matches/single/6": { id: 6, status: "scheduled" },
    "/matches/scheduled?status=live": live,
  };
  Object.assign(m.state.responses, responses);
  await m.matchesService.list({ status: "live" }); // establishes the live set
  await m.matchesService.list({});
  await m.matchesService.list({ status: "completed" });
  await m.matchesService.list({ team: "nejmeh" });
  await m.matchesService.list({ team: "nejmeh", status: "live" });
  await m.matchesService.details(5);
  await m.matchesService.details(6);
}

test("scheduled → live: affected lists and the match's detail are dropped, owners are told", async () => {
  const m = await load();
  const transitions = [];
  m.onLiveTransition((transition) => transitions.push(transition));
  await primeLists(m, []);

  m.advance(31 * 1000);
  m.state.responses["/matches/scheduled?status=live"] = [{ id: 5 }]; // kickoff
  await m.matchesService.list({ status: "live" }, true);
  assert.deepEqual(transitions, [{ entered: ["5"], left: [] }]);
  assert.equal(m.matchesService.peekList({}), null, "scheduled list dropped");
  assert.equal(m.matchesService.peekList({ status: "completed" }), null, "results dropped");
  assert.equal(m.matchesService.peekList({ team: "nejmeh" }), null, "filtered list dropped");
  assert.equal(m.matchesService.peekList({ team: "nejmeh", status: "live" }), null, "filtered live list dropped");
  assert.deepEqual(m.matchesService.peekList({ status: "live" }).value, [{ id: 5 }], "the accepted live answer itself is kept");
  await m.matchesService.details(5);
  await m.matchesService.details(6);
  assert.equal(count(m.state, "/matches/single/5"), 2, "the match that kicked off is re-read");
  assert.equal(count(m.state, "/matches/single/6"), 1, "an unaffected match keeps its detail");
});

test("live → completed: the finished match's lists and detail are dropped, owners are told", async () => {
  const m = await load();
  const transitions = [];
  m.onLiveTransition((transition) => transitions.push(transition));
  await primeLists(m, [{ id: 5 }]);

  m.advance(31 * 1000);
  m.state.responses["/matches/scheduled?status=live"] = []; // full time
  await m.matchesService.list({ status: "live" }, true);
  assert.deepEqual(transitions, [{ entered: [], left: ["5"] }]);
  assert.equal(m.matchesService.peekList({ status: "completed" }), null, "results re-read (the match is now a result)");
  assert.equal(m.matchesService.peekList({}), null);
  assert.equal(m.matchesService.peekList({ team: "nejmeh", status: "live" }), null);
  await m.matchesService.details(5);
  assert.equal(count(m.state, "/matches/single/5"), 2);
});

test("an unchanged live list invalidates nothing and tells no one", async () => {
  const m = await load();
  const transitions = [];
  m.onLiveTransition((transition) => transitions.push(transition));
  m.state.responses["/matches/scheduled"] = [];
  m.state.responses["/matches/scheduled?status=live"] = [{ id: 1 }];
  await m.matchesService.list({ status: "live" });
  await m.matchesService.list({});
  m.advance(31 * 1000);
  await m.matchesService.list({ status: "live" });
  assert.notEqual(m.matchesService.peekList({}), null);
  assert.deepEqual(transitions, []);
});

test("an older live response that loses to a newer one changes nothing (deterministic overlap)", async () => {
  const m = await load();
  const transitions = [];
  m.onLiveTransition((transition) => transitions.push(transition));
  m.state.responses["/matches/scheduled"] = [{ id: 9 }];
  m.state.responses["/matches/scheduled?status=live"] = [];
  await m.matchesService.list({ status: "live" }); // live set: none
  await m.matchesService.list({});

  // Each live request gets its own controllable answer.
  const answers = [];
  m.state.responses["/matches/scheduled?status=live"] = () =>
    new Promise((resolve) => answers.push(resolve));
  const requestA = m.matchesService.list({ status: "live" }, true); // 1. A begins (older state: 9 was live)
  const requestB = m.matchesService.list({ status: "live" }, true); // 2. B begins
  await Promise.resolve();
  assert.equal(answers.length, 2);
  answers[1]([]); //                                                   3. B resolves: still nothing live
  assert.deepEqual(await requestB, []);
  answers[0]([{ id: 9 }]); //                                          4. A resolves later with the older state
  const resultA = await requestA;

  assert.deepEqual(resultA, [], "5. A's caller receives B's authoritative answer, not its obsolete one");
  assert.deepEqual(m.matchesService.peekList({ status: "live" }).value, [], "B remains the cached answer");
  assert.deepEqual(transitions, [], "6. A caused no transition");
  assert.notEqual(m.matchesService.peekList({}), null, "and no invalidation");
  // A later accepted answer is compared against B's live set (none), not A's.
  m.state.responses["/matches/scheduled?status=live"] = [];
  await m.matchesService.list({ status: "live" }, true);
  assert.deepEqual(transitions, []);
});

test("a live response superseded while in flight never becomes the cached or returned answer", async () => {
  const m = await load();
  m.state.responses["/matches/scheduled?status=live"] = [];
  await m.matchesService.list({ status: "live" });
  const transitions = [];
  m.onLiveTransition((transition) => transitions.push(transition));
  let resolveFirst;
  let calls = 0;
  m.state.responses["/matches/scheduled?status=live"] = () => {
    calls += 1;
    return calls === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : [{ id: 3 }];
  };
  const pending = m.matchesService.list({ status: "live" }, true);
  const newer = m.matchesService.list({ status: "live" }, true);
  assert.deepEqual(await newer, [{ id: 3 }]);
  resolveFirst([]);
  assert.deepEqual(await pending, [{ id: 3 }]);
  assert.deepEqual(transitions, [{ entered: ["3"], left: [] }], "only the accepted answer moved the live set");
});

test("an unchanged live list invalidates nothing", async () => {
  const m = await load();
  m.state.responses["/matches/scheduled"] = [];
  m.state.responses["/matches/scheduled?status=live"] = [{ id: 1 }];
  await m.matchesService.list({ status: "live" });
  await m.matchesService.list({});
  m.advance(31 * 1000);
  await m.matchesService.list({ status: "live" });
  assert.notEqual(m.matchesService.peekList({}), null);
});

test("a live match detail is only fresh for 30 s; a scheduled one keeps 5 min", async () => {
  const m = await load();
  m.state.responses["/matches/single/1"] = { id: 1, status: "live" };
  m.state.responses["/matches/single/2"] = { id: 2, status: "scheduled" };
  await m.matchesService.details(1);
  await m.matchesService.details(2);
  m.advance(31 * 1000);
  await m.matchesService.details(1);
  await m.matchesService.details(2);
  assert.equal(count(m.state, "/matches/single/1"), 2);
  assert.equal(count(m.state, "/matches/single/2"), 1);
});

test("live match detail uses the tight live policy (30 s fresh, 2 min stale limit)", async () => {
  const m = await load();
  assert.deepEqual(m.MATCH_POLICIES.liveDetail, { freshMs: 30 * 1000, maxStaleMs: 2 * 60 * 1000 });
  m.state.responses["/matches/single/1"] = { id: 1, status: "live" };
  await m.matchesService.details(1);
  m.advance(3 * 60 * 1000);
  // Older than the live stale limit: never served, always re-read.
  m.state.responses["/matches/single/1"] = { id: 1, status: "completed" };
  assert.equal((await m.matchesService.details(1)).status, "completed");
  assert.equal(count(m.state, "/matches/single/1"), 2);
});

test("the pre-commit re-check (forced) always reaches the backend", async () => {
  const m = await load();
  m.state.responses["/matches/single/2"] = { id: 2, status: "scheduled" };
  await m.matchesService.details(2);
  await m.matchesService.details(2, true);
  assert.equal(count(m.state, "/matches/single/2"), 2);
});

test("seat availability is only reused for 30 s", async () => {
  const m = await load();
  const path = "/matches/4/zones/9/seats";
  m.state.responses[path] = { zone: { id: 9, name: "A" }, seats: [] };
  await m.matchesService.seats(4, 9);
  m.advance(10 * 1000);
  await m.matchesService.seats(4, 9);
  m.advance(25 * 1000);
  await m.matchesService.seats(4, 9);
  assert.equal(count(m.state, path), 2);
});

test("concurrent identical match reads (Home + Matches) share one request", async () => {
  const m = await load();
  let resolve;
  m.state.responses["/matches/scheduled?status=live"] = () => new Promise((yes) => { resolve = yes; });
  const home = m.matchesService.list({ status: "live" });
  const matches = m.matchesService.list({ status: "live" });
  resolve([]);
  await Promise.all([home, matches]);
  assert.equal(m.state.calls.length, 1);
});

test("a failed list is not cached", async () => {
  const m = await load();
  m.state.responses["/matches/scheduled"] = new Error("offline");
  await assert.rejects(() => m.matchesService.list({}), /offline/);
  assert.equal(m.matchesService.peekList({}), null);
});

/* Wiring (source) ----------------------------------------------------------- */

test("a successful checkout invalidates the user's portal cache", async () => {
  const success = await read("../app/checkout/success.tsx");
  assert.match(success, /import \{ invalidatePortalCache \} from "@\/services\/cachedReads";/);
  assert.match(success, /useEffect\(\(\) => \{\s*invalidatePortalCache\(\);\s*\}, \[\]\);/);
});

test("the portal cache is scoped to the user-scoped cache generation and cleared with it", async () => {
  const reads = await read("./cachedReads.ts");
  assert.match(reads, /const portalCache = createQueryCache\(\{ scope: getUserScopedCacheGeneration \}\);/);
  assert.match(reads, /onUserScopedCacheInvalidated\(\(\) => portalCache\.clear\(\)\);/);
});

test("screens seed from the cache instead of showing a loading state on revisit", async () => {
  const hook = await read("../hooks/useScheduledMatches.ts");
  assert.match(hook, /const \[initial\] = useState\(\(\) => \(enabled \? matchesService\.peekList\(requestFiltersOf\(filters\)\) : null\)\);/);
  assert.match(hook, /const \[loadingFlag, setLoadingFlag\] = useState\(initial === null\);/);
  const tickets = await read("../app/tickets.tsx");
  assert.match(tickets, /const \[loading, setLoading\] = useState\(cachedList === null\);/);
  assert.match(tickets, /setDetailLoading\(cachedTickets === null\);/);
  const competitions = await read("../app/competitions.tsx");
  assert.match(competitions, /const cached = competitionReads\.peekList\(\);/);
});

test("nothing transactional goes through the read cache", async () => {
  for (const path of ["../context/CartContext.tsx", "../app/checkout.tsx", "../components/CardPaymentScreen.tsx", "../components/BluePaymentScreen.native.tsx", "./cart.ts", "./checkout.ts"]) {
    const source = await read(path);
    assert.doesNotMatch(source, /queryCache|cachedReads|portalReads/, path);
  }
});

test("unknown-payment / payment-lock recovery opens My Tickets with the refresh signal", async () => {
  for (const path of ["../app/checkout.tsx", "../components/CardPaymentScreen.tsx", "../components/BluePaymentScreen.native.tsx"]) {
    const source = await read(path);
    assert.match(source, /import \{ PAYMENT_RECOVERY_TICKETS_ROUTE \} from "@\/lib\/paymentRecoveryTickets";/, path);
    assert.match(source, /router\.replace\(PAYMENT_RECOVERY_TICKETS_ROUTE\)/, path);
    assert.doesNotMatch(source, /router\.replace\("\/tickets"\)/, `${path}: no recovery path opens a cached My Tickets`);
  }
  const recovery = await read("../lib/paymentRecoveryTickets.ts");
  assert.match(recovery, /pathname: "\/tickets",\s*params: \{ refresh: "payment" \}/);
});

test("My Tickets consumes the recovery signal before it seeds from the cache", async () => {
  const tickets = await read("../app/tickets.tsx");
  const visit = tickets.indexOf("useState(() => beginTicketsVisit(params.refresh));");
  const seed = tickets.indexOf('portalReads.peekMatches("all")');
  assert.ok(visit > 0 && seed > visit, "the recovery invalidation runs first");
});

test("mounted owners re-read after a live transition (no polling added)", async () => {
  const hook = await read("../hooks/useScheduledMatches.ts");
  assert.match(hook, /return onLiveTransition\(\(\) => void load\("revalidate"\)\);/);
  const competitions = await read("../app/competitions.tsx");
  assert.match(competitions, /return onLiveTransition\(\(\) => void loadDetail\(selectedId, knockout, "revalidate"\)\);/);
  const reads = await read("./cachedReads.ts");
  assert.match(reads, /onLiveTransition\(\(\) => \{\s*competitionCache\.invalidate\(\(key\) => key\.startsWith\("standings:"\) \|\| key\.startsWith\("matches:"\)\);/);
});

test("every explicit Competitions Retry forces a backend read", async () => {
  const competitions = await read("../app/competitions.tsx");
  assert.match(competitions, /const force = mode === "retry" \|\| mode === "refresh";/);
  assert.match(competitions, /const retryDetail = \(\) => \{\s*if \(selectedId !== null\) void loadDetail\(selectedId, knockout, "retry"\);/);
  assert.equal((competitions.match(/onPress: retryDetail/g) ?? []).length, 3, "standings error, standings unavailable, matches error");
  assert.match(competitions, /void loadList\(true\); \} \}\}/);
  assert.doesNotMatch(competitions, /onPress: \(\) => selectedId !== null && void loadDetail\(selectedId, knockout\)/);
});
