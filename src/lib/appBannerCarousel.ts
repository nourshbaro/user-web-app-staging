export type BannerSwipeDirection = "next" | "previous";
export type BannerInstanceRole = "previous" | "current" | "next" | "handoff";

export function createBannerImageInstanceKey(
  role: BannerInstanceRole,
  bannerId: number,
  imageUrl: string,
  generation?: number,
) {
  return JSON.stringify([role, bannerId, imageUrl, generation ?? null]);
}

export type BannerDisplayIdentity = {
  generation: number;
  bannerId: number;
  imageUrl: string;
  role: BannerInstanceRole;
};

export type BannerTransitionOwnership = {
  generation: number;
  bannerId: number;
  imageUrl: string;
  direction: BannerSwipeDirection;
  adjacentRole: "previous" | "next";
  phase: "handoff" | "current";
};

export function createBannerTransitionAuthority() {
  let generation = 0;
  let ownership: BannerTransitionOwnership | null = null;

  const matches = (
    identity: BannerDisplayIdentity,
    role: BannerInstanceRole,
  ) => Boolean(
    ownership
    && identity.generation === ownership.generation
    && identity.bannerId === ownership.bannerId
    && identity.imageUrl === ownership.imageUrl
    && identity.role === role
  );

  return {
    begin(
      bannerId: number,
      imageUrl: string,
      direction: BannerSwipeDirection,
    ) {
      if (ownership) return null;
      generation += 1;
      ownership = {
        generation,
        bannerId,
        imageUrl,
        direction,
        adjacentRole: direction === "next" ? "next" : "previous",
        phase: "handoff",
      };
      return { ...ownership };
    },
    beginCurrentRecovery(bannerId: number, imageUrl: string) {
      if (ownership) return null;
      generation += 1;
      ownership = {
        generation,
        bannerId,
        imageUrl,
        direction: "next",
        adjacentRole: "next",
        phase: "current",
      };
      return { ...ownership };
    },
    acceptHandoffDisplay(identity: BannerDisplayIdentity) {
      if (!ownership || ownership.phase !== "handoff" || !matches(identity, "handoff")) {
        return false;
      }
      ownership = { ...ownership, phase: "current" };
      return true;
    },
    acceptCurrentDisplay(identity: BannerDisplayIdentity) {
      if (!ownership || ownership.phase !== "current" || !matches(identity, "current")) {
        return false;
      }
      ownership = null;
      return true;
    },
    isCurrent(candidate: BannerTransitionOwnership | null) {
      return Boolean(
        candidate
        && ownership
        && candidate.generation === ownership.generation
        && candidate.bannerId === ownership.bannerId
        && candidate.imageUrl === ownership.imageUrl
        && candidate.direction === ownership.direction
        && candidate.adjacentRole === ownership.adjacentRole
      );
    },
    current() {
      return ownership ? { ...ownership } : null;
    },
    invalidate() {
      generation += 1;
      ownership = null;
    },
  };
}

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
