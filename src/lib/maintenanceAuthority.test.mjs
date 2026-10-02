import assert from "node:assert/strict";
import { test } from "node:test";
import { createMaintenanceAuthority } from "./maintenanceAuthority.ts";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("a 503 signal activates maintenance once and notifies", () => {
  const authority = createMaintenanceAuthority();
  let notifications = 0;
  authority.subscribe(() => {
    notifications += 1;
  });
  authority.signal();
  authority.signal();
  assert.equal(authority.isActive(), true);
  assert.equal(notifications, 1);
});

test("recheck clears only on an available probe, and never without one", async () => {
  const authority = createMaintenanceAuthority();
  authority.signal();
  assert.equal(await authority.recheck(async () => "maintenance"), "maintenance");
  assert.equal(await authority.recheck(async () => "unreachable"), "unreachable");
  assert.equal(await authority.recheck(async () => {
    throw new Error("boom");
  }), "unreachable");
  assert.equal(authority.isActive(), true);
  assert.equal(await authority.recheck(async () => "available"), "recovered");
  assert.equal(authority.isActive(), false);
});

test("recheck without maintenance makes no request", async () => {
  const authority = createMaintenanceAuthority();
  let probes = 0;
  assert.equal(await authority.recheck(async () => {
    probes += 1;
    return "available";
  }), "recovered");
  assert.equal(probes, 0);
});

test("concurrent rechecks share one probe; the next tap after it settles probes again", async () => {
  const authority = createMaintenanceAuthority();
  authority.signal();
  let probes = 0;
  const gate = deferred();
  const probe = () => {
    probes += 1;
    return gate.promise;
  };
  const a = authority.recheck(probe);
  const b = authority.recheck(probe);
  assert.equal(a, b);
  gate.resolve("maintenance");
  assert.equal(await a, "maintenance");
  assert.equal(probes, 1);
  await authority.recheck(async () => {
    probes += 1;
    return "maintenance";
  });
  assert.equal(probes, 2);
});

test("a 503 signalled while the probe is in flight keeps maintenance", async () => {
  const authority = createMaintenanceAuthority();
  authority.signal();
  const gate = deferred();
  const pending = authority.recheck(() => gate.promise);
  authority.signal();
  gate.resolve("available");
  assert.equal(await pending, "maintenance");
  assert.equal(authority.isActive(), true);
});
