/**
 * The backend cart total, as a number. Pure module (no runtime imports).
 *
 * Only a finite number, or a plain decimal string such as "0" or "12.50",
 * is a total. Anything else (missing, null, "", whitespace, booleans, hex,
 * non-numeric text) is unavailable and becomes NaN: never 0, because a zero
 * total turns Checkout into a free order (`payment_method: "free"`).
 * `formatMoney` shows NaN as "Price unavailable".
 */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export function parseCartTotal(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "string" && DECIMAL.test(value.trim())) return Number(value.trim());
  return Number.NaN;
}

/** Case 1 of free checkout: items in the cart and a validated backend total of exactly 0. */
export function isFreeCartTotal(total: number, itemCount: number) {
  return itemCount > 0 && Number.isFinite(total) && total === 0;
}
