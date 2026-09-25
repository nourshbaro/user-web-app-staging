import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_AUTOMATIC_RELOADS,
  parseDirectionAttempt,
  planDirection,
  serializeDirectionAttempt,
} from "./directionTransition.ts";

test("matching direction (native LTR, locale LTR) is ready immediately", () => {
  assert.deepEqual(planDirection({ desired: "ltr", active: "ltr", attempt: null }), { phase: "ready", clearAttempt: false });
});

test("mismatch (native RTL, locale LTR) is never ready: apply once and reload", () => {
  const plan = planDirection({ desired: "ltr", active: "rtl", attempt: null });
  assert.equal(plan.phase, "apply-and-reload");
  assert.deepEqual(plan.attempt, { desired: "ltr", attempts: 1 });
});

test("after the reload, a now-matching direction resumes readiness and clears the marker", () => {
  const plan = planDirection({ desired: "ltr", active: "ltr", attempt: { desired: "ltr", attempts: 1 } });
  assert.deepEqual(plan, { phase: "ready", clearAttempt: true });
});

test("a mismatch that survives the automatic reload blocks instead of reloading again", () => {
  const plan = planDirection({ desired: "ltr", active: "rtl", attempt: { desired: "ltr", attempts: MAX_AUTOMATIC_RELOADS } });
  assert.deepEqual(plan, { phase: "restart-required" });
});

test("simulated launches can never produce more than the allowed automatic reloads", () => {
  // Worst case: the native direction never changes, across many launches.
  let stored = null;
  let reloads = 0;
  const phases = [];
  for (let launch = 0; launch < 10; launch += 1) {
    const plan = planDirection({ desired: "ltr", active: "rtl", attempt: parseDirectionAttempt(stored) });
    phases.push(plan.phase);
    if (plan.phase === "apply-and-reload") {
      stored = serializeDirectionAttempt(plan.attempt);
      reloads += 1;
    }
  }
  assert.equal(reloads, MAX_AUTOMATIC_RELOADS);
  assert.deepEqual(phases.slice(MAX_AUTOMATIC_RELOADS), Array(10 - MAX_AUTOMATIC_RELOADS).fill("restart-required"));
});

test("future Arabic: LTR native + RTL locale also transitions safely", () => {
  assert.equal(planDirection({ desired: "rtl", active: "ltr", attempt: null }).phase, "apply-and-reload");
  assert.equal(planDirection({ desired: "rtl", active: "rtl", attempt: { desired: "rtl", attempts: 1 } }).phase, "ready");
});

test("a marker for a different desired direction does not consume this transition's budget", () => {
  const plan = planDirection({ desired: "rtl", active: "ltr", attempt: { desired: "ltr", attempts: 1 } });
  assert.equal(plan.phase, "apply-and-reload");
});

test("malformed markers are treated as absent; valid ones round-trip", () => {
  for (const raw of [null, "", "not json", "{}", '{"desired":"up","attempts":1}', '{"desired":"ltr","attempts":-1}', '{"desired":"ltr","attempts":1.5}']) {
    assert.equal(parseDirectionAttempt(raw), null, raw);
  }
  assert.deepEqual(parseDirectionAttempt(serializeDirectionAttempt({ desired: "rtl", attempts: 1 })), { desired: "rtl", attempts: 1 });
});

test("the provider renders app content only when ready and guards every reload", async () => {
  const source = await readFile(new URL("./I18nProvider.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(phase === "restart-required"\) return <DirectionRestartRequired/);
  assert.match(source, /if \(!isReady\) return null;/);
  assert.match(source, /const isReady = phase === "ready";/);
  // The marker is persisted before any automatic reload; failing to persist blocks instead.
  const persistIndex = source.indexOf("await storage.set(DIRECTION_ATTEMPT_STORAGE_KEY");
  const reloadingIndex = source.indexOf('return "reloading";');
  assert.ok(persistIndex > 0 && reloadingIndex > persistIndex);
  assert.match(source, /\} catch \{\s*return "restart-required";\s*\}\s*return "reloading";/);
  // A silent no-op reload falls back to the blocking state.
  assert.match(source, /setTimeout\(\(\) => \{\s*if \(active\) setPhase\("restart-required"\);/);
});
