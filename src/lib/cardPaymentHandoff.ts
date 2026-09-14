import type { CheckoutSubmitRequest } from "@/types";

type CardPaymentHandoff = {
  id: string;
  sessionId: string;
  captureContext: string | null;
  prepareCaptureContext: (force?: boolean) => Promise<string>;
  request: Omit<CheckoutSubmitRequest, "payment">;
};

let sequence = 0;
let activeHandoff: CardPaymentHandoff | null = null;

export function createCardPaymentHandoff(input: Omit<CardPaymentHandoff, "id">) {
  sequence += 1;
  const id = `${Date.now()}-${sequence}`;
  activeHandoff = { id, ...input };
  return id;
}

export function readCardPaymentHandoff(id: string) {
  return activeHandoff?.id === id ? activeHandoff : null;
}

export function clearCardPaymentHandoff(id: string) {
  if (activeHandoff?.id === id) activeHandoff = null;
}
