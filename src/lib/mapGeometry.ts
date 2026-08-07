export type CoordinatePoint = {
  x: unknown;
  y: unknown;
};

export type ZoneGeometryInput = {
  shape_data?: CoordinatePoint[] | null;
};

export type SeatCoordinateInput = {
  x?: unknown;
  y?: unknown;
};

export type PositionedSeat<T> = T & {
  px: number;
  py: number;
};

const SEAT_SIZE = 18;
const SEAT_GAP = 10;
const HORIZONTAL_PADDING = 36;
const TOP_PADDING = 50;
const BOTTOM_PADDING = 38;

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function getPolygonPoints(zone: ZoneGeometryInput) {
  if (!Array.isArray(zone.shape_data)) return [];
  return zone.shape_data.flatMap((point) => {
    const x = finiteNumber(point?.x);
    const y = finiteNumber(point?.y);
    return x === null || y === null ? [] : [{ x, y }];
  });
}

export function getPolygonPointsAttribute(zone: ZoneGeometryInput) {
  return getPolygonPoints(zone).map((point) => `${point.x},${point.y}`).join(" ");
}

export function getContainRect(containerWidth: number, containerHeight: number, contentWidth: number, contentHeight: number) {
  if (containerWidth <= 0 || containerHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight);
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return {
    width,
    height,
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2,
  };
}

function smallestPositiveGap(values: number[]) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < unique.length; index += 1) {
    const gap = unique[index] - unique[index - 1];
    if (gap > 0 && gap < smallest) smallest = gap;
  }
  return smallest;
}

export function createSeatLayout<T extends SeatCoordinateInput>(seats: T[], viewportWidth: number) {
  if (!seats.length) {
    return {
      seats: [] as PositionedSeat<T>[],
      width: viewportWidth,
      height: Math.round(viewportWidth * 0.72),
      scale: 1,
    };
  }

  const raw = seats.map((seat, index) => {
    const x = finiteNumber(seat.x);
    const y = finiteNumber(seat.y);
    if (x !== null && y !== null) return { seat, x, y };
    const column = index % 8;
    const row = Math.floor(index / 8);
    return { seat, x: 40 + column * 44, y: 36 + row * 42 };
  });
  const xs = raw.map((item) => item.x);
  const ys = raw.map((item) => item.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const mapWidth = Math.max(0, maxX - minX);
  const mapHeight = Math.max(0, maxY - minY);
  const coordinateGap = Math.min(smallestPositiveGap(xs), smallestPositiveGap(ys));
  const scale = Number.isFinite(coordinateGap) ? Math.max(1, (SEAT_SIZE + SEAT_GAP) / coordinateGap) : 1;
  const contentWidth = mapWidth * scale + SEAT_SIZE;
  const contentHeight = mapHeight * scale + SEAT_SIZE;

  return {
    width: Math.max(viewportWidth, Math.ceil(contentWidth + HORIZONTAL_PADDING * 2)),
    height: Math.max(240, Math.ceil(contentHeight + TOP_PADDING + BOTTOM_PADDING)),
    scale,
    seats: raw.map(({ seat, x, y }) => ({
      ...seat,
      px: HORIZONTAL_PADDING + (x - minX) * scale,
      py: TOP_PADDING + (y - minY) * scale,
    })),
  };
}
