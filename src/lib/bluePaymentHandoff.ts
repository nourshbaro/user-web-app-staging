type BluePaymentHandoff = {
  id: string;
  paymentUrl: string;
};

let sequence = 0;
let activeHandoff: BluePaymentHandoff | null = null;

export function createBluePaymentHandoff(paymentUrl: string) {
  sequence += 1;
  const id = `${Date.now()}-${sequence}`;
  activeHandoff = { id, paymentUrl };
  return id;
}

export function readBluePaymentHandoff(id: string) {
  return activeHandoff?.id === id ? activeHandoff : null;
}

export function clearBluePaymentHandoff(id: string) {
  if (activeHandoff?.id === id) activeHandoff = null;
}
