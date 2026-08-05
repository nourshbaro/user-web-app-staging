export type CheckoutResultProvider = "blue" | "cybersource" | "unknown";

export type CheckoutResultParams = {
  provider: CheckoutResultProvider;
  order_id?: string;
  order_number?: string;
  reference?: string;
  status?: string;
  reason?: string;
  reasonMessage?: string;
};

type RawValue = string | string[] | number | null | undefined;
export type RawCheckoutResultParams = {
  provider?: RawValue;
  order_id?: RawValue;
  order_number?: RawValue;
  reference?: RawValue;
  payment_reference?: RawValue;
  status?: RawValue;
  reason?: RawValue;
};

export type CheckoutResultSearchParams = {
  provider?: string | string[];
  order_id?: string | string[];
  order_number?: string | string[];
  reference?: string | string[];
  payment_reference?: string | string[];
  status?: string | string[];
  reason?: string | string[];
};

const MAX_DISPLAY_LENGTH = 120;
const REASON_MESSAGES: Record<string, string> = {
  payment_declined: "The payment was declined. Please use another payment method or contact your bank.",
  payment_failed: "The payment could not be completed.",
  payment_expired: "The payment session expired before it could be completed.",
};

export function parseCheckoutResultParams(raw: RawCheckoutResultParams): CheckoutResultParams {
  const provider = parseProvider(raw.provider);
  const orderId = displayValue(raw.order_id);
  const orderNumber = displayValue(raw.order_number);
  const reference = displayValue(raw.reference) ?? displayValue(raw.payment_reference);
  const status = displayValue(raw.status);
  const reason = reasonCode(raw.reason);

  return {
    provider,
    ...(orderId ? { order_id: orderId } : {}),
    ...(orderNumber ? { order_number: orderNumber } : {}),
    ...(reference ? { reference } : {}),
    ...(status ? { status } : {}),
    ...(reason ? { reason, reasonMessage: REASON_MESSAGES[reason] } : {}),
  };
}

export function checkoutResultRouteParams(params: CheckoutResultParams) {
  return {
    ...(params.provider !== "unknown" ? { provider: params.provider } : {}),
    ...(params.order_id ? { order_id: params.order_id } : {}),
    ...(params.order_number ? { order_number: params.order_number } : {}),
    ...(params.reference ? { reference: params.reference } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  };
}

function parseProvider(value: RawValue): CheckoutResultProvider {
  if (Array.isArray(value) || typeof value !== "string") return "unknown";
  const candidate = value.trim();
  return candidate === "blue" || candidate === "cybersource" ? candidate : "unknown";
}

function displayValue(value: RawValue) {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === "number") {
    return Number.isFinite(first) ? String(first).slice(0, MAX_DISPLAY_LENGTH) : undefined;
  }
  if (typeof first !== "string") return undefined;
  return first.trim().slice(0, MAX_DISPLAY_LENGTH) || undefined;
}

function reasonCode(value: RawValue) {
  const candidate = displayValue(value);
  return candidate && Object.hasOwn(REASON_MESSAGES, candidate) ? candidate : undefined;
}
