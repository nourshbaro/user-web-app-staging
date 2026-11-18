import { translate } from "../i18n/runtime.ts";
import type { MessageKey } from "../i18n/messages/en";

/** "free": a zero-total order (`payment_method: "free"`), no payment provider. */
export type CheckoutResultProvider = "blue" | "cybersource" | "free" | "unknown";

export type CheckoutResultParams = {
  provider: CheckoutResultProvider;
  /** Display-only: the one match the submitted order covered (never a ticket id). */
  match_id?: string;
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
  match_id?: RawValue;
  order_id?: RawValue;
  order_number?: RawValue;
  reference?: RawValue;
  payment_reference?: RawValue;
  status?: RawValue;
  reason?: RawValue;
};

export type CheckoutResultSearchParams = {
  provider?: string | string[];
  match_id?: string | string[];
  order_id?: string | string[];
  order_number?: string | string[];
  reference?: string | string[];
  payment_reference?: string | string[];
  status?: string | string[];
  reason?: string | string[];
};

const MAX_DISPLAY_LENGTH = 120;
const REASON_MESSAGES: Record<string, MessageKey> = {
  payment_declined: "payment.reason.declined",
  payment_failed: "payment.reason.failed",
  payment_expired: "payment.reason.expired",
};

export function parseCheckoutResultParams(raw: RawCheckoutResultParams): CheckoutResultParams {
  const provider = parseProvider(raw.provider);
  const matchId = numericId(raw.match_id);
  const orderId = displayValue(raw.order_id);
  const orderNumber = displayValue(raw.order_number);
  const reference = displayValue(raw.reference) ?? displayValue(raw.payment_reference);
  const status = displayValue(raw.status);
  const reason = reasonCode(raw.reason);

  return {
    provider,
    ...(matchId ? { match_id: matchId } : {}),
    ...(orderId ? { order_id: orderId } : {}),
    ...(orderNumber ? { order_number: orderNumber } : {}),
    ...(reference ? { reference } : {}),
    ...(status ? { status } : {}),
    ...(reason ? { reason, reasonMessage: REASON_MESSAGES[reason] ? translate(REASON_MESSAGES[reason]) : undefined } : {}),
  };
}

export function checkoutResultRouteParams(params: CheckoutResultParams) {
  return {
    ...(params.provider !== "unknown" ? { provider: params.provider } : {}),
    ...(params.match_id ? { match_id: params.match_id } : {}),
    ...(params.order_id ? { order_id: params.order_id } : {}),
    ...(params.order_number ? { order_number: params.order_number } : {}),
    ...(params.reference ? { reference: params.reference } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  };
}

/**
 * The match a just-submitted order covered, from the submitted
 * `tickets_by_match` (keys are backend match ids): only when exactly one match
 * has tickets. Several matches → null (My Tickets list; no ticket is chosen).
 */
export function singlePurchasedMatchId(ticketsByMatch: Record<string, unknown[]> | null | undefined) {
  if (!ticketsByMatch || typeof ticketsByMatch !== "object") return null;
  const matches = Object.keys(ticketsByMatch).filter((key) => Array.isArray(ticketsByMatch[key]) && ticketsByMatch[key].length > 0);
  return matches.length === 1 && /^\d{1,12}$/.test(matches[0]) ? matches[0] : null;
}

function numericId(value: RawValue) {
  const first = Array.isArray(value) ? value[0] : value;
  const text = typeof first === "number" && Number.isInteger(first) ? String(first) : typeof first === "string" ? first.trim() : "";
  return /^\d{1,12}$/.test(text) ? text : undefined;
}

function parseProvider(value: RawValue): CheckoutResultProvider {
  if (Array.isArray(value) || typeof value !== "string") return "unknown";
  const candidate = value.trim();
  return candidate === "blue" || candidate === "cybersource" || candidate === "free" ? candidate : "unknown";
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
