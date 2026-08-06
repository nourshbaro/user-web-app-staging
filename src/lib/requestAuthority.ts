export type RequestTicket = {
  generation: number;
  identity: string;
};

export function createRequestIdentity(parts: readonly (string | number | boolean | null | undefined)[]) {
  return JSON.stringify(parts.map((part) => part ?? null));
}

export function createRequestAuthority() {
  let generation = 0;
  let mounted = true;
  let activeIdentity: string | null = null;

  return {
    mount() {
      generation += 1;
      mounted = true;
    },
    begin(identity: string): RequestTicket {
      generation += 1;
      activeIdentity = identity;
      return { generation, identity };
    },
    invalidate(identity: string | null = activeIdentity) {
      generation += 1;
      activeIdentity = identity;
    },
    unmount() {
      generation += 1;
      mounted = false;
    },
    isCurrent(ticket: RequestTicket, currentIdentity: string = ticket.identity) {
      return mounted
        && ticket.generation === generation
        && ticket.identity === activeIdentity
        && ticket.identity === currentIdentity;
    },
  };
}
