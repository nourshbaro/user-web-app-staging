import assert from "node:assert/strict";
import test from "node:test";
import {
  getTicketMatchName,
  getTicketOrderReference,
  normalizePaginatedProfileResult,
} from "./profilePortal.ts";

test("pagination preserves an authoritative total larger than the current page", () => {
  const data = Array.from({ length: 20 }, (_, index) => ({ id: index + 1 }));
  const payload = {
    data,
    meta: {
      page: 1,
      per_page: 20,
      total: 47,
      last_page: 3,
    },
  };

  const result = normalizePaginatedProfileResult(payload);

  assert.equal(result.items.length, 20);
  assert.equal(result.total, 47);
  assert.deepEqual(result.items, data);
  assert.notStrictEqual(result.items, data);
});

test("orders staging response preserves total 19", () => {
  const result = normalizePaginatedProfileResult({
    data: [{ id: 118, order_code: "ORD-1118" }],
    meta: {
      page: 1,
      per_page: 20,
      total: 19,
      last_page: 1,
    },
  });

  assert.deepEqual(result.items, [{ id: 118, order_code: "ORD-1118" }]);
  assert.equal(result.total, 19);
});

test("tickets staging response preserves total 18", () => {
  const result = normalizePaginatedProfileResult({
    data: [{ ticket_code: "4007292891" }],
    meta: {
      page: 1,
      per_page: 20,
      total: 18,
      last_page: 1,
    },
  });

  assert.deepEqual(result.items, [{ ticket_code: "4007292891" }]);
  assert.equal(result.total, 18);
});

test("missing or malformed totals fall back to loaded item count", () => {
  const data = [{ id: 1 }, { id: 2 }];

  for (const meta of [
    undefined,
    {},
    { total: "47" },
    { total: -1 },
    { total: 18.5 },
    { total: Number.NaN },
    { total: Number.POSITIVE_INFINITY },
  ]) {
    const result = normalizePaginatedProfileResult({ data, meta });
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 2);
  }
});

test("fractional totals are rejected as non-integer counts", () => {
  const result = normalizePaginatedProfileResult({
    data: [{ id: 1 }, { id: 2 }, { id: 3 }],
    meta: { total: 18.5 },
  });

  assert.equal(result.items.length, 3);
  assert.equal(result.total, 3);
});

test("malformed paginated payloads safely produce an empty result", () => {
  for (const payload of [
    null,
    undefined,
    "invalid",
    [],
    {},
    { data: null },
    { data: {} },
  ]) {
    assert.deepEqual(
      normalizePaginatedProfileResult(payload),
      { items: [], total: 0 },
    );
  }
});

test("ticket helpers expose the confirmed order and match metadata", () => {
  const ticket = {
    ticket_code: "4007292891",
    order_code: "ORD-1118",
    match: {
      home_team: "Al Riyadi Al Abasiya",
      away_team: "Al Safa",
    },
  };

  assert.equal(getTicketOrderReference(ticket), "ORD-1118");
  assert.equal(
    getTicketMatchName(ticket),
    "Al Riyadi Al Abasiya vs Al Safa",
  );
});

test("ticket helpers reject missing, blank, and non-string display values", () => {
  assert.equal(getTicketOrderReference(null), null);
  assert.equal(getTicketOrderReference({ order_code: {} }), null);
  assert.equal(getTicketOrderReference({ order_code: "   " }), null);

  assert.equal(getTicketMatchName(null), null);
  assert.equal(
    getTicketMatchName({
      match: {
        home_team: {},
        away_team: "Al Safa",
      },
    }),
    null,
  );
  assert.equal(
    getTicketMatchName({
      match: {
        home_team: "Al Riyadi Al Abasiya",
        away_team: [],
      },
    }),
    null,
  );
  assert.equal(
    getTicketMatchName({
      match: {
        home_team: "Al Riyadi Al Abasiya",
      },
    }),
    null,
  );
});