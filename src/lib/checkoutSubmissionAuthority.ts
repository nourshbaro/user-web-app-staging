export type CheckoutSubmissionTicket = Readonly<{
  generation: number;
  sessionId: string;
}>;

export function createCheckoutSubmissionAuthority() {
  let generation = 0;
  let mounted = true;
  let activeSessionId: string | null = null;

  const isCurrent = (ticket: CheckoutSubmissionTicket) =>
    mounted
    && ticket.generation === generation
    && ticket.sessionId === activeSessionId;

  return {
    mount() {
      generation += 1;
      mounted = true;
      activeSessionId = null;
    },
    begin(sessionId: string): CheckoutSubmissionTicket {
      generation += 1;
      activeSessionId = sessionId;
      return { generation, sessionId };
    },
    invalidate() {
      generation += 1;
      activeSessionId = null;
    },
    unmount() {
      generation += 1;
      mounted = false;
      activeSessionId = null;
    },
    isCurrent,
    finish(ticket: CheckoutSubmissionTicket) {
      if (!isCurrent(ticket)) return false;
      generation += 1;
      activeSessionId = null;
      return true;
    },
  };
}