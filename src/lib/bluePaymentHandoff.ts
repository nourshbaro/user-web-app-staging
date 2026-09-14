type BluePaymentHandoff = {
  id: string;
  paymentUrl: string;
  sessionId: string;
};

export type PendingBluePaymentAttempt = {
  sessionId: string;
  paymentUrl: string;
  orderId?: string;
  orderNumber?: string;
  reference?: string;
  paymentReference?: string;
};

let sequence = 0;
let activeHandoff: BluePaymentHandoff | null = null;
let pendingAttempt: PendingBluePaymentAttempt | null = null;

export function createBluePaymentHandoff(paymentUrl: string, sessionId: string) {
  sequence += 1;
  const id = `${Date.now()}-${sequence}`;
  activeHandoff = { id, paymentUrl, sessionId };
  return id;
}

export function readBluePaymentHandoff(id: string) {
  return activeHandoff?.id === id ? activeHandoff : null;
}

export function clearBluePaymentHandoff(id: string) {
  if (activeHandoff?.id === id) activeHandoff = null;
}

export function savePendingBluePaymentAttempt(attempt: PendingBluePaymentAttempt) {
  pendingAttempt = attempt;
}

export function readPendingBluePaymentAttempt(sessionId: string) {
  return pendingAttempt?.sessionId === sessionId ? pendingAttempt : null;
}

export function clearPendingBluePaymentAttempt(sessionId?: string) {
  if (sessionId === undefined || pendingAttempt?.sessionId === sessionId) {
    pendingAttempt = null;
  }
}

export function invalidatePendingBluePaymentAttemptUnlessSession(sessionId: string | null) {
  if (pendingAttempt && pendingAttempt.sessionId !== sessionId) pendingAttempt = null;
}
