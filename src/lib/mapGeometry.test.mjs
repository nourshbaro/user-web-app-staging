import assert from "node:assert/strict";
import test from "node:test";
import { createSeatLayout, getContainRect, getPolygonPoints, getPolygonPointsAttribute } from "./mapGeometry.ts";

test("polygon geometry retains every valid point in order", () => {
  const zone = { shape_data: [{ x: 10, y: 20 }, { x: "35", y: "12" }, { x: 42, y: 55 }] };
  assert.deepEqual(getPolygonPoints(zone), [{ x: 10, y: 20 }, { x: 35, y: 12 }, { x: 42, y: 55 }]);
  assert.equal(getPolygonPointsAttribute(zone), "10,20 35,12 42,55");
});

test("polygon geometry rejects malformed points", () => {
  const zone = { shape_data: [{ x: {}, y: 20 }, { x: 1, y: Number.NaN }, { x: 3, y: 4 }] };
  assert.deepEqual(getPolygonPoints(zone), [{ x: 3, y: 4 }]);
});

test("contain rect has zero offsets when container and content aspect ratios match", () => {
  assert.deepEqual(getContainRect(300, 200, 600, 400), {
    width: 300,
    height: 200,
    offsetX: 0,
    offsetY: 0,
  });
});

test("contain rect centers horizontal letterboxing", () => {
  assert.deepEqual(getContainRect(400, 200, 600, 600), {
    width: 200,
    height: 200,
    offsetX: 100,
    offsetY: 0,
  });
});

test("contain rect centers vertical letterboxing", () => {
  assert.deepEqual(getContainRect(200, 400, 600, 300), {
    width: 200,
    height: 100,
    offsetX: 0,
    offsetY: 150,
  });
});

test("seat layout preserves aspect ratio with one uniform scale", () => {
  const layout = createSeatLayout(
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 }],
    320,
  );
  const horizontal = layout.seats[1].px - layout.seats[0].px;
  const vertical = layout.seats[2].py - layout.seats[0].py;
  assert.equal(vertical / horizontal, 2);
  assert.equal(horizontal, 28);
});

test("seat layout grows instead of compressing large coordinate extents", () => {
  const layout = createSeatLayout(
    [{ x: 0, y: 0 }, { x: 1000, y: 500 }],
    320,
  );
  assert.equal(layout.scale, 1);
  assert.ok(layout.width > 1000);
  assert.ok(layout.height > 500);
});

test("seat layout uses the fallback grid only for invalid coordinate pairs", () => {
  const layout = createSeatLayout(
    [{ x: 0, y: 0 }, { x: null, y: 10 }, { x: 88, y: undefined }],
    320,
  );
  assert.equal(layout.seats[0].px, 36);
  assert.notEqual(layout.seats[1].px, layout.seats[0].px);
  assert.notEqual(layout.seats[2].py, layout.seats[0].py);
});
