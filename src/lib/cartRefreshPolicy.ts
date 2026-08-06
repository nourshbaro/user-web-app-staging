export type CartRefreshFailure = {
  kind: "terminal" | "transient";
  shouldClearSession: boolean;
};

export function classifyCartRefreshFailure(status: number | null): CartRefreshFailure {
  if (status === 404) {
    return { kind: "terminal", shouldClearSession: true };
  }

  return { kind: "transient", shouldClearSession: false };
}

export function createCartRefreshGuard() {
  let latestRequestId = 0;

  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    invalidate() {
      latestRequestId += 1;
    },
    isCurrent(requestId: number) {
      return requestId === latestRequestId;
    },
  };
}
