import assert from "node:assert/strict";
import test from "node:test";
import { createCybersourceWebLifecycle, CYBERSOURCE_SCRIPT_ERROR } from "./cybersourceWebLifecycle.ts";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

function checkout(mount = Promise.resolve("token")) {
  const value = {
    destroyed: 0,
    ready: null,
    mountCalls: 0,
    on(event, handler) {
      if (event === "ready") this.ready = handler;
    },
    mount() {
      this.mountCalls += 1;
      return mount;
    },
    destroy() {
      this.destroyed += 1;
    },
  };
  return value;
}

function client(createdCheckout = Promise.resolve(checkout())) {
  return {
    destroyed: 0,
    createCalls: 0,
    createCheckout() {
      this.createCalls += 1;
      return createdCheckout;
    },
    destroy() {
      this.destroyed += 1;
    },
  };
}

function harness(unifiedCheckout) {
  const events = [];
  const lifecycle = createCybersourceWebLifecycle({
    captureContext: "context",
    unifiedCheckout,
    onReady: () => events.push(["ready"]),
    onSuccess: (token) => events.push(["success", token]),
    onError: (message) => events.push(["error", message]),
  });
  return { lifecycle, events };
}

function scriptTarget() {
  const listeners = { load: new Set(), error: new Set() };
  return {
    addEventListener(type, listener) { listeners[type].add(listener); },
    removeEventListener(type, listener) { listeners[type].delete(listener); },
    emit(type) { for (const listener of [...listeners[type]]) listener(); },
    count(type) { return listeners[type].size; },
  };
}

test("stale during UnifiedCheckout destroys the late A client without publication", async () => {
  const pendingA = deferred();
  const a = harness(() => pendingA.promise);
  const bCheckout = checkout();
  const bClient = client(Promise.resolve(bCheckout));
  const b = harness(() => Promise.resolve(bClient));
  void a.lifecycle.start();
  a.lifecycle.invalidate();
  await b.lifecycle.start();
  const aClient = client();
  pendingA.resolve(aClient);
  await flush();
  assert.equal(aClient.destroyed, 1);
  assert.deepEqual(a.events, []);
  assert.deepEqual(b.events, [["success", "token"]]);
});

test("stale during createCheckout destroys late A checkout and leaves B unaffected", async () => {
  const pendingCheckout = deferred();
  const aClient = client(pendingCheckout.promise);
  const a = harness(() => Promise.resolve(aClient));
  void a.lifecycle.start();
  await flush();
  a.lifecycle.invalidate();
  const b = harness(() => Promise.resolve(client()));
  await b.lifecycle.start();
  const lateCheckout = checkout();
  pendingCheckout.resolve(lateCheckout);
  await flush();
  assert.equal(lateCheckout.destroyed, 1);
  assert.equal(aClient.destroyed, 1);
  assert.deepEqual(b.events, [["success", "token"]]);
});

test("stale during mount ignores A token while B remains current", async () => {
  const pendingMount = deferred();
  const aCheckout = checkout(pendingMount.promise);
  const a = harness(() => Promise.resolve(client(Promise.resolve(aCheckout))));
  void a.lifecycle.start();
  await flush();
  a.lifecycle.invalidate();
  const b = harness(() => Promise.resolve(client()));
  await b.lifecycle.start();
  pendingMount.resolve("token-a");
  await flush();
  assert.deepEqual(a.events, []);
  assert.deepEqual(b.events, [["success", "token"]]);
});

test("unmount during UnifiedCheckout destroys late client and emits nothing", async () => {
  const pending = deferred();
  const { lifecycle, events } = harness(() => pending.promise);
  void lifecycle.start();
  lifecycle.invalidate();
  const lateClient = client();
  pending.resolve(lateClient);
  await flush();
  assert.equal(lateClient.destroyed, 1);
  assert.deepEqual(events, []);
});

test("unmount during createCheckout cleans late checkout and client", async () => {
  const pending = deferred();
  const ownedClient = client(pending.promise);
  const { lifecycle, events } = harness(() => Promise.resolve(ownedClient));
  void lifecycle.start();
  await flush();
  lifecycle.invalidate();
  const lateCheckout = checkout();
  pending.resolve(lateCheckout);
  await flush();
  assert.equal(ownedClient.destroyed, 1);
  assert.equal(lateCheckout.destroyed, 1);
  assert.deepEqual(events, []);
});

test("unmount during mount ignores late success and error", async () => {
  for (const outcome of ["resolve", "reject"]) {
    const pending = deferred();
    const { lifecycle, events } = harness(() => Promise.resolve(client(Promise.resolve(checkout(pending.promise)))));
    void lifecycle.start();
    await flush();
    lifecycle.invalidate();
    pending[outcome](outcome === "resolve" ? "late-token" : new Error("late-error"));
    await flush();
    assert.deepEqual(events, []);
  }
});

test("stale ready callback cannot mark a replacement lifetime ready", async () => {
  const pending = deferred();
  const ownedCheckout = checkout(pending.promise);
  const { lifecycle, events } = harness(() => Promise.resolve(client(Promise.resolve(ownedCheckout))));
  void lifecycle.start();
  await flush();
  lifecycle.invalidate();
  ownedCheckout.ready();
  assert.deepEqual(events, []);
  pending.resolve("ignored");
});

test("stale success callback cannot invoke a B-era callback", async () => {
  const pending = deferred();
  const a = harness(() => Promise.resolve(client(Promise.resolve(checkout(pending.promise)))));
  void a.lifecycle.start();
  await flush();
  a.lifecycle.invalidate();
  pending.resolve("token-a");
  await flush();
  assert.deepEqual(a.events, []);
});

test("stale error callback cannot invoke a B-era callback", async () => {
  const pending = deferred();
  const a = harness(() => Promise.resolve(client(Promise.resolve(checkout(pending.promise)))));
  void a.lifecycle.start();
  await flush();
  a.lifecycle.invalidate();
  pending.reject(new Error("A failed"));
  await flush();
  assert.deepEqual(a.events, []);
});

test("B initializes while A remains pending", async () => {
  const pendingA = deferred();
  const a = harness(() => pendingA.promise);
  const bClient = client();
  const b = harness(() => Promise.resolve(bClient));
  void a.lifecycle.start();
  a.lifecycle.invalidate();
  await b.lifecycle.start();
  assert.equal(bClient.createCalls, 1);
  assert.deepEqual(b.events, [["success", "token"]]);
});

test("stale cleanup and finalization cannot destroy B-owned resources", async () => {
  const pendingA = deferred();
  const a = harness(() => pendingA.promise);
  const bCheckout = checkout();
  const bClient = client(Promise.resolve(bCheckout));
  const b = harness(() => Promise.resolve(bClient));
  void a.lifecycle.start();
  a.lifecycle.invalidate();
  await b.lifecycle.start();
  const bDestroyed = [bClient.destroyed, bCheckout.destroyed];
  pendingA.resolve(client());
  await flush();
  assert.deepEqual([bClient.destroyed, bCheckout.destroyed], bDestroyed);
});

test("current lifetime mounts and emits one success callback", async () => {
  const ownedCheckout = checkout(Promise.resolve("current-token"));
  const { lifecycle, events } = harness(() => Promise.resolve(client(Promise.resolve(ownedCheckout))));
  await lifecycle.start();
  await lifecycle.start();
  assert.equal(ownedCheckout.mountCalls, 1);
  assert.deepEqual(events, [["success", "current-token"]]);
});

test("current lifetime sanitizes provider errors", async () => {
  const { lifecycle, events } = harness(() => Promise.reject({ reason: "current failure" }));
  await lifecycle.start();
  assert.deepEqual(events, [["error", "Payment could not be completed. Please try again."]]);
});

test("script load after cleanup does not start stale initialization", () => {
  let starts = 0;
  const { lifecycle } = harness(async () => { starts += 1; return client(); });
  const script = scriptTarget();
  lifecycle.listenForScript(script);
  lifecycle.invalidate();
  script.emit("load");
  assert.equal(script.count("load"), 0);
  assert.equal(starts, 0);
});

test("script error after cleanup does not publish stale error", () => {
  const { lifecycle, events } = harness(() => Promise.resolve(client()));
  const script = scriptTarget();
  lifecycle.listenForScript(script);
  lifecycle.invalidate();
  script.emit("error");
  assert.equal(script.count("error"), 0);
  assert.deepEqual(events, []);
});

test("current script error remains visible", () => {
  const { lifecycle, events } = harness(() => Promise.resolve(client()));
  const script = scriptTarget();
  lifecycle.listenForScript(script);
  script.emit("error");
  assert.deepEqual(events, [["error", CYBERSOURCE_SCRIPT_ERROR]]);
});
