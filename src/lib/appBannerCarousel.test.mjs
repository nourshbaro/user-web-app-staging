import assert from "node:assert/strict";
import test from "node:test";
import {
  createBannerImageInstanceKey,
  createBannerTransitionAuthority,
} from "./appBannerCarousel.ts";

const handoff = (owner, overrides = {}) => ({
  generation: owner.generation,
  bannerId: owner.bannerId,
  imageUrl: owner.imageUrl,
  role: "handoff",
  ...overrides,
});
const current = (owner, overrides = {}) => ({
  generation: owner.generation,
  bannerId: owner.bannerId,
  imageUrl: owner.imageUrl,
  role: "current",
  ...overrides,
});

test("transition generation A starts", () => {
  const authority = createBannerTransitionAuthority();
  assert.equal(authority.begin(2, "b.jpg", "next").generation, 1);
});

test("stale display event from an older generation is ignored", () => {
  const authority = createBannerTransitionAuthority();
  const old = authority.begin(2, "b.jpg", "next");
  authority.invalidate();
  const active = authority.begin(2, "b.jpg", "next");
  assert.equal(authority.acceptHandoffDisplay(handoff(old)), false);
  assert.equal(authority.isCurrent(active), true);
});

test("handoff display event for wrong banner ID is ignored", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  assert.equal(authority.acceptHandoffDisplay(handoff(owner, { bannerId: 3 })), false);
});

test("handoff display event for wrong URL is ignored", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  assert.equal(authority.acceptHandoffDisplay(handoff(owner, { imageUrl: "old.jpg" })), false);
});

test("correct handoff onDisplay allows reconciliation", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  assert.equal(authority.acceptHandoffDisplay(handoff(owner)), true);
  assert.equal(authority.current().phase, "current");
});

test("current-slide display before correct handoff is ignored", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  assert.equal(authority.acceptCurrentDisplay(current(owner)), false);
});

test("current-slide display for wrong generation is ignored", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  authority.acceptHandoffDisplay(handoff(owner));
  assert.equal(authority.acceptCurrentDisplay(current(owner, { generation: 0 })), false);
});

test("current-slide display for wrong source is ignored", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  authority.acceptHandoffDisplay(handoff(owner));
  assert.equal(authority.acceptCurrentDisplay(current(owner, { imageUrl: "a.jpg" })), false);
});

test("correct current-slide display permits handoff removal and unlock", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  authority.acceptHandoffDisplay(handoff(owner));
  assert.equal(authority.acceptCurrentDisplay(current(owner)), true);
  assert.equal(authority.current(), null);
});

test("second transition cannot start during handoff or reconciliation", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  assert.equal(authority.begin(3, "c.jpg", "next"), null);
  authority.acceptHandoffDisplay(handoff(owner));
  assert.equal(authority.begin(3, "c.jpg", "next"), null);
});

test("two-banner duplicate directional instances remain distinguishable", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  assert.equal(owner.adjacentRole, "next");
  assert.equal(authority.acceptHandoffDisplay(handoff(owner, { role: "previous" })), false);
});

test("failure invalidates current ownership safely", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  authority.invalidate();
  assert.equal(authority.isCurrent(owner), false);
  assert.equal(authority.current(), null);
});

test("displayed handoff failure recovery waits for the replacement current instance", () => {
  const authority = createBannerTransitionAuthority();
  authority.begin(2, "b.jpg", "next");
  authority.invalidate();
  const recovery = authority.beginCurrentRecovery(1, "a.jpg");
  assert.equal(authority.acceptCurrentDisplay(current(recovery, { imageUrl: "b.jpg" })), false);
  assert.equal(authority.acceptCurrentDisplay(current(recovery)), true);
});

test("unmount invalidates pending ownership", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  authority.invalidate();
  assert.equal(authority.acceptHandoffDisplay(handoff(owner)), false);
});

test("layout reset invalidates pending ownership", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "previous");
  authority.invalidate();
  assert.equal(authority.acceptHandoffDisplay(handoff(owner)), false);
});

test("reduced-motion transition still follows readiness ownership", () => {
  const authority = createBannerTransitionAuthority();
  const owner = authority.begin(2, "b.jpg", "next");
  assert.equal(authority.acceptCurrentDisplay(current(owner)), false);
  assert.equal(authority.acceptHandoffDisplay(handoff(owner)), true);
  assert.equal(authority.acceptCurrentDisplay(current(owner)), true);
});

test("auto and manual paths use the same authority model", () => {
  for (const direction of ["next", "previous"]) {
    const authority = createBannerTransitionAuthority();
    const owner = authority.begin(2, "b.jpg", direction);
    assert.equal(authority.acceptHandoffDisplay(handoff(owner)), true);
    assert.equal(authority.acceptCurrentDisplay(current(owner)), true);
  }
});

test("current A and current B have different native image identities", () => {
  assert.notEqual(
    createBannerImageInstanceKey("current", 1, "a.jpg"),
    createBannerImageInstanceKey("current", 2, "b.jpg"),
  );
});

test("next B and current B have different native image identities", () => {
  assert.notEqual(
    createBannerImageInstanceKey("next", 2, "b.jpg"),
    createBannerImageInstanceKey("current", 2, "b.jpg"),
  );
});

test("previous B and next B have different native image identities", () => {
  assert.notEqual(
    createBannerImageInstanceKey("previous", 2, "b.jpg"),
    createBannerImageInstanceKey("next", 2, "b.jpg"),
  );
});

test("same banner ID with a changed URL has a new native image identity", () => {
  assert.notEqual(
    createBannerImageInstanceKey("current", 2, "old.jpg"),
    createBannerImageInstanceKey("current", 2, "new.jpg"),
  );
});

test("same URL with a changed banner ID has a new native image identity", () => {
  assert.notEqual(
    createBannerImageInstanceKey("current", 1, "shared.jpg"),
    createBannerImageInstanceKey("current", 2, "shared.jpg"),
  );
});

test("handoff transition generations have different native image identities", () => {
  assert.notEqual(
    createBannerImageInstanceKey("handoff", 2, "b.jpg", 1),
    createBannerImageInstanceKey("handoff", 2, "b.jpg", 2),
  );
});

test("old A instance identity cannot equal B current ownership identity", () => {
  const oldA = createBannerImageInstanceKey("current", 1, "a.jpg");
  const currentB = createBannerImageInstanceKey("current", 2, "b.jpg");
  assert.notEqual(oldA, currentB);
});

test("handoff B identity remains distinct from positional B during replacement", () => {
  const handoffB = createBannerImageInstanceKey("handoff", 2, "b.jpg", 4);
  assert.notEqual(handoffB, createBannerImageInstanceKey("current", 2, "b.jpg"));
  assert.notEqual(handoffB, createBannerImageInstanceKey("next", 2, "b.jpg"));
});

test("two-banner A and B positional identities are all unique", () => {
  const identities = [
    createBannerImageInstanceKey("previous", 2, "b.jpg"),
    createBannerImageInstanceKey("current", 1, "a.jpg"),
    createBannerImageInstanceKey("next", 2, "b.jpg"),
  ];
  assert.equal(new Set(identities).size, identities.length);
});

test("failure recovery destination identity cannot reuse failed destination identity", () => {
  assert.notEqual(
    createBannerImageInstanceKey("current", 2, "failed-b.jpg"),
    createBannerImageInstanceKey("current", 1, "safe-a.jpg"),
  );
});
