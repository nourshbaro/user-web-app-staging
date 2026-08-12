export type AuthSubmissionGuard = {
  tryAcquire: () => boolean;
  release: () => void;
};

export function createAuthSubmissionGuard(): AuthSubmissionGuard {
  let inFlight = false;

  return {
    tryAcquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() {
      inFlight = false;
    },
  };
}
