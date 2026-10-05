import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const transpile = (source) =>
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const toModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const queryCacheUrl = toModuleUrl(transpile(await read("../lib/queryCache.ts")));
const recoveryUrl = toModuleUrl(transpile(await read("../lib/paymentRecoveryTickets.ts")));
const cachedReadsSource = await read("./cachedReads.ts");
let instance = 0;

/**
 * A fresh cachedReads module per test, over the real query cache and the real
 * user-scoped cache generation, with counting fakes for the raw services.
 */
async function load() {
  instance += 1;
  const key = `__cachedReads_${instance}`;
  const state = { calls: [], answers: {}, pending: null };
  globalThis[key] = state;
  const userScopedUrl = toModuleUrl(`${transpile(await read("../lib/userScopedCache.ts"))}\n// ${key}`);
  const fake = (name) => `(...args) => {
    const state = globalThis[${JSON.stringify(key)}];
    state.calls.push([${JSON.stringify(name)}, ...args]);
    if (state.pending) return state.pending;
    const answer = state.answers[${JSON.stringify(name)}];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }`;
  const authUrl = toModuleUrl(`export const profileService = { matches: ${fake("matches")}, tickets: ${fake("tickets")} };`);
  const competitionsUrl = toModuleUrl(
    `export const competitionsService = { list: ${fake("list")}, standings: ${fake("standings")}, matches: ${fake("competitionMatches")} };`,
  );
  // The matches service's transition channel, fired by the test.
  const matchesUrl = toModuleUrl(`
    const listeners = new Set();
    export function onLiveTransition(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    export function fireTransition(transition) { listeners.forEach((listener) => listener(transition)); }
    // ${key}
  `);
  const source = transpile(cachedReadsSource)
    .replace('from "@/lib/paymentRecoveryTickets"', `from ${JSON.stringify(recoveryUrl)}`)
    .replace('from "@/lib/queryCache"', `from ${JSON.stringify(queryCacheUrl)}`)
    .replace('from "@/lib/userScopedCache"', `from ${JSON.stringify(userScopedUrl)}`)
    .replace('from "@/services/auth"', `from ${JSON.stringify(authUrl)}`)
    .replace('from "@/services/competitions"', `from ${JSON.stringify(competitionsUrl)}`)
    .replace('from "@/services/matches"', `from ${JSON.stringify(matchesUrl)}`);
  const reads = await import(toModuleUrl(`${source}\n// ${key}`));
  const userScoped = await import(userScopedUrl);
  const matches = await import(matchesUrl);
  return { reads, userScoped, state, fireTransition: matches.fireTransition };
}

test("a fresh portal read is reused: no second request", async () => {
  const { reads, state } = await load();
  state.answers.matches = { items: [{ match_id: 1 }], total: 1 };
  await reads.portalReads.matches("all");
  await reads.portalReads.matches("all");
  assert.equal(state.calls.length, 1);
  assert.deepEqual(reads.portalReads.peekMatches("all").value.items, [{ match_id: 1 }]);
});

test("portal filters and match ids are separate entries", async () => {
  const { reads, state } = await load();
  state.answers.matches = { items: [], total: 0 };
  state.answers.tickets = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  await reads.portalReads.matches("upcoming");
  await reads.portalReads.tickets(1);
  await reads.portalReads.tickets(2);
  assert.deepEqual(state.calls, [["matches", "all"], ["matches", "upcoming"], ["tickets", 1], ["tickets", 2]]);
});

test("logout / account switch: another user's portal data is never reused", async () => {
  const { reads, userScoped, state } = await load();
  state.answers.matches = { items: [{ match_id: "A" }], total: 1 };
  await reads.portalReads.matches("all");

  userScoped.clearUserScopedCaches(); // AuthContext does this on every identity change
  assert.equal(reads.portalReads.peekMatches("all"), null, "nothing of user A is shown");
  state.answers.matches = { items: [{ match_id: "B" }], total: 1 };
  assert.deepEqual((await reads.portalReads.matches("all")).items, [{ match_id: "B" }]);
  assert.equal(state.calls.length, 2, "user B made its own request");
});

test("a portal response that started before an identity change is not cached for the next user", async () => {
  const { reads, userScoped, state } = await load();
  let resolve;
  state.pending = new Promise((yes) => {
    resolve = yes;
  });
  const lateA = reads.portalReads.matches("all");
  userScoped.clearUserScopedCaches();
  resolve({ items: [{ match_id: "A" }], total: 1 });
  await lateA;
  assert.equal(reads.portalReads.peekMatches("all"), null);
});

test("a purchase invalidates every portal read, so My Tickets and Home re-read", async () => {
  const { reads, state } = await load();
  state.answers.matches = { items: [], total: 0 };
  state.answers.tickets = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  await reads.portalReads.matches("upcoming");
  await reads.portalReads.tickets(7);
  reads.invalidatePortalCache();
  assert.equal(reads.portalReads.peekMatches("all"), null);
  assert.equal(reads.portalReads.peekTickets(7), null);
  await reads.portalReads.matches("all");
  assert.equal(state.calls.length, 4);
});

test("pull-to-refresh forces a portal read", async () => {
  const { reads, state } = await load();
  state.answers.matches = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  await reads.portalReads.matches("all", true);
  assert.equal(state.calls.length, 2);
});

test("failed portal reads are not cached", async () => {
  const { reads, state } = await load();
  state.answers.matches = new Error("offline");
  await assert.rejects(() => reads.portalReads.matches("all"), /offline/);
  assert.equal(reads.portalReads.peekMatches("all"), null);
  state.answers.matches = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  assert.equal(state.calls.length, 2);
});

test("competitions: revisiting the same competition reuses list, standings and matches", async () => {
  const { reads, state } = await load();
  state.answers.list = [{ id: 1 }];
  state.answers.standings = { kind: "table", standings: { rows: [] } };
  state.answers.competitionMatches = [];
  for (let visit = 0; visit < 2; visit += 1) {
    await reads.competitionReads.list();
    await reads.competitionReads.standings(1);
    await reads.competitionReads.matches(1);
  }
  assert.deepEqual(state.calls.map(([name]) => name), ["list", "standings", "competitionMatches"]);
  await reads.competitionReads.matches(2);
  assert.equal(state.calls.length, 4, "another competition is its own entry");
});

test("competitions: a 404 'unavailable' answer is cached; an error is not", async () => {
  const { reads, state } = await load();
  state.answers.standings = { kind: "unavailable" };
  await reads.competitionReads.standings(2);
  await reads.competitionReads.standings(2);
  assert.equal(state.calls.length, 1);
  state.answers.standings = new Error("500");
  await assert.rejects(() => reads.competitionReads.standings(3), /500/);
  assert.equal(reads.competitionReads.peekStandings(3), null);
});

test("competition data is public: an identity change does not drop it", async () => {
  const { reads, userScoped, state } = await load();
  state.answers.list = [{ id: 1 }];
  await reads.competitionReads.list();
  userScoped.clearUserScopedCaches();
  await reads.competitionReads.list();
  assert.equal(state.calls.length, 1);
});

/* Unknown-payment recovery ---------------------------------------------- */

test("unknown-payment recovery: My Tickets re-reads the portal even with a fresh pre-payment cache", async () => {
  const { reads, state } = await load();
  state.answers.matches = { items: [], total: 0 }; // before the payment: no tickets
  state.answers.tickets = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  await reads.portalReads.matches("upcoming");
  await reads.portalReads.tickets(12);
  assert.equal(state.calls.length, 3);

  // The order may have gone through: the user chooses "View my tickets" from the unknown outcome.
  assert.equal(reads.beginTicketsVisit("payment"), true);
  assert.equal(reads.portalReads.peekMatches("all"), null, "nothing cached before the payment is shown");
  state.answers.matches = { items: [{ match_id: 12 }], total: 1 };
  state.answers.tickets = { items: [{ ticket_code: "T1" }], total: 1 };
  assert.deepEqual((await reads.portalReads.matches("all")).items, [{ match_id: 12 }]);
  assert.deepEqual((await reads.portalReads.tickets(12)).items, [{ ticket_code: "T1" }]);
  assert.deepEqual(state.calls.slice(3), [["matches", "all"], ["tickets", 12]], "real backend reads");
});

test("the recovery signal also works as an array param, and only the exact value triggers it", async () => {
  const { reads, state } = await load();
  state.answers.matches = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  assert.equal(reads.beginTicketsVisit(["payment"]), true);
  await reads.portalReads.matches("all");
  assert.equal(state.calls.length, 2);
  assert.equal(reads.beginTicketsVisit("other"), false);
  await reads.portalReads.matches("all");
  assert.equal(state.calls.length, 2);
});

test("an ordinary My Tickets visit keeps normal caching", async () => {
  const { reads, state } = await load();
  state.answers.matches = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  assert.equal(reads.beginTicketsVisit(undefined), false);
  await reads.portalReads.matches("all");
  assert.equal(state.calls.length, 1);
});

/* Competition retry and transitions --------------------------------------- */

test("an explicit Retry re-reads standings despite a fresh cached 'unavailable' answer", async () => {
  const { reads, state } = await load();
  state.answers.standings = { kind: "unavailable" };
  await reads.competitionReads.standings(1);
  await reads.competitionReads.standings(1); // ordinary navigation: reused
  assert.equal(state.calls.length, 1);
  state.answers.standings = { kind: "table", standings: { rows: [] } };
  assert.deepEqual(await reads.competitionReads.standings(1, true), { kind: "table", standings: { rows: [] } }); // Retry
  assert.equal(state.calls.length, 2);
});

test("a match entering or leaving play drops competition matches and standings, not the list", async () => {
  const { reads, state, fireTransition } = await load();
  state.answers.list = [{ id: 1 }];
  state.answers.standings = { kind: "table", standings: { rows: [] } };
  state.answers.competitionMatches = [];
  await reads.competitionReads.list();
  await reads.competitionReads.standings(1);
  await reads.competitionReads.matches(1);
  await reads.competitionReads.matches(2);

  fireTransition({ entered: [], left: ["5"] }); // full time somewhere
  assert.equal(reads.competitionReads.peekStandings(1), null);
  assert.equal(reads.competitionReads.peekMatches(1), null);
  assert.equal(reads.competitionReads.peekMatches(2), null);
  assert.notEqual(reads.competitionReads.peekList(), null, "the competition list is unaffected");
  await reads.competitionReads.standings(1);
  await reads.competitionReads.matches(1);
  assert.deepEqual(state.calls.slice(4).map(([name]) => name), ["standings", "competitionMatches"]);
});

test("a transition does not touch the user's portal data", async () => {
  const { reads, state, fireTransition } = await load();
  state.answers.matches = { items: [], total: 0 };
  await reads.portalReads.matches("all");
  fireTransition({ entered: ["5"], left: [] });
  await reads.portalReads.matches("all");
  assert.equal(state.calls.length, 1);
});
