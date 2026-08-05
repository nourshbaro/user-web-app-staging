export type BannerSwipeDirection = "next" | "previous";

const HORIZONTAL_ACTIVATION_DISTANCE = 10;
const HORIZONTAL_DOMINANCE_RATIO = 1.35;
const MINIMUM_SWIPE_DISTANCE = 48;
const SWIPE_WIDTH_RATIO = 0.18;
const MINIMUM_SWIPE_VELOCITY = 0.55;

export function normalizeBannerIndex(index: number, count: number) {
  if (!Number.isFinite(index) || !Number.isInteger(count) || count <= 0) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

export function isHorizontalBannerGesture(dx: number, dy: number) {
  const horizontalDistance = Math.abs(dx);
  return (
    horizontalDistance >= HORIZONTAL_ACTIVATION_DISTANCE
    && horizontalDistance > Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO
  );
}

export function classifyBannerSwipe(
  dx: number,
  dy: number,
  velocityX: number,
  viewportWidth: number,
): BannerSwipeDirection | null {
  if (!isHorizontalBannerGesture(dx, dy)) return null;

  const distanceThreshold = Math.max(
    MINIMUM_SWIPE_DISTANCE,
    Math.max(0, viewportWidth) * SWIPE_WIDTH_RATIO,
  );
  if (
    Math.abs(dx) < distanceThreshold
    && Math.abs(velocityX) < MINIMUM_SWIPE_VELOCITY
  ) {
    return null;
  }

  return dx < 0 ? "next" : "previous";
}

export function shouldAutoRotateBanners(
  count: number,
  appIsActive: boolean,
  screenReaderEnabled: boolean,
  reduceMotionEnabled: boolean,
) {
  return (
    count > 1
    && appIsActive
    && !screenReaderEnabled
    && !reduceMotionEnabled
  );
}
