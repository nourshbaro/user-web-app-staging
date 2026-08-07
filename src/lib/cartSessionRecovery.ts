type SessionPayload = {
  checkout_session_id?: string;
};

type AddWithSessionRecoveryOptions<Payload extends object, Response> = {
  payload: Payload;
  sessionId: string | null;
  add: (payload: Payload & SessionPayload) => Promise<Response>;
  getStatus: (error: unknown) => number | null;
  invalidateRejectedSession: (sessionId: string) => Promise<void>;
};

export async function addWithSessionRecovery<Payload extends object, Response>({
  payload,
  sessionId,
  add,
  getStatus,
  invalidateRejectedSession,
}: AddWithSessionRecoveryOptions<Payload, Response>): Promise<Response> {
  try {
    return await add(sessionId ? { ...payload, checkout_session_id: sessionId } : payload);
  } catch (error) {
    if (!sessionId || getStatus(error) !== 404) throw error;
    await invalidateRejectedSession(sessionId);
    return add(payload);
  }
}

export function createSingleFlight() {
  let current: Promise<unknown> | null = null;

  return {
    run<Result>(operation: () => Promise<Result>): Promise<Result> {
      if (current) return current as Promise<Result>;
      const pending = operation();
      current = pending;
      void pending.finally(() => {
        if (current === pending) current = null;
      }).catch(() => {});
      return pending;
    },
  };
}
