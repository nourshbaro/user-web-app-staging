type OperationOptions = {
  trackLoading?: boolean;
};

export function createCartOperationQueue(
  onMutationLoadingChange: (loading: boolean) => void,
) {
  let tail: Promise<void> = Promise.resolve();
  let pendingMutations = 0;

  return {
    run<Result>(
      operation: () => Promise<Result>,
      { trackLoading = true }: OperationOptions = {},
    ): Promise<Result> {
      if (trackLoading) {
        pendingMutations += 1;
        if (pendingMutations === 1) onMutationLoadingChange(true);
      }

      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );

      return result.finally(() => {
        if (!trackLoading) return;
        pendingMutations -= 1;
        if (pendingMutations === 0) onMutationLoadingChange(false);
      });
    },
  };
}