export type CartSessionTicket = Readonly<{
  generation: number;
  sessionId: string | null;
}>;

export function createCartSessionAuthority() {
  let generation = 0;
  let sessionId: string | null = null;
  let persistenceTail: Promise<void> = Promise.resolve();

  const currentTicket = (): CartSessionTicket => ({ generation, sessionId });

  const isCurrent = (ticket: CartSessionTicket) =>
    ticket.generation === generation && ticket.sessionId === sessionId;

  return {
    currentSessionId() {
      return sessionId;
    },
    capture() {
      return sessionId === null ? null : currentTicket();
    },
    replace(nextSessionId: string | null) {
      generation += 1;
      sessionId = nextSessionId;
      return currentTicket();
    },
    isCurrent,
    clear(ticket: CartSessionTicket) {
      if (!isCurrent(ticket)) return null;
      generation += 1;
      sessionId = null;
      return currentTicket();
    },
    enqueuePersistence<T>(operation: () => Promise<T>) {
      const pending = persistenceTail.then(operation, operation);
      persistenceTail = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  };
}

export type CartSessionAuthority = ReturnType<typeof createCartSessionAuthority>;

export async function clearCartSessionIfCurrent({
  authority,
  expected,
  removePersistedSession,
  canCommit,
  resetDisplayState,
}: {
  authority: CartSessionAuthority;
  expected: CartSessionTicket;
  removePersistedSession: () => Promise<void>;
  canCommit: () => boolean;
  resetDisplayState: () => void;
}) {
  if (!authority.isCurrent(expected)) return null;

  await authority.enqueuePersistence(removePersistedSession);

  if (!canCommit() || !authority.isCurrent(expected)) return null;

  const cleared = authority.clear(expected);
  if (!cleared) return null;

  resetDisplayState();
  return cleared;
}