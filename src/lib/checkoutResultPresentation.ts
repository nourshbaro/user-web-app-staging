import type { CheckoutResultParams } from "@/lib/checkoutResultParams";

export type CheckoutResultOutcome = "success" | "failed";

/**
 * Catalog keys for a result route. Pure (no React Native imports).
 *
 * These routes are reached only from production's own terminal handling:
 * `success` after a trusted, matched completion (the cart was already cleared
 * for that session); `failed` from the provider's failure return. Neither
 * claims more than that: success never promises fields the backend did not
 * send, and failure never states that no order exists.
 */
export function getCheckoutResultPresentation(outcome: CheckoutResultOutcome) {
  if (outcome === "success") {
    return {
      titleKey: "result.success.title",
      messageKey: "result.success.message",
      primaryAction: { labelKey: "result.success.tickets", href: "/tickets" as const },
      secondaryAction: { labelKey: "result.home", href: "/" as const },
    } as const;
  }
  return {
    titleKey: "result.failed.title",
    messageKey: "result.failed.message",
    primaryAction: { labelKey: "result.failed.browse", href: "/matches" as const },
    secondaryAction: { labelKey: "result.home", href: "/" as const },
  } as const;
}

/** "Paid with" label key, only when the provider is known. */
export function getCheckoutResultProviderKey(provider: CheckoutResultParams["provider"]) {
  if (provider === "blue") return "result.provider.blue" as const;
  if (provider === "cybersource") return "result.provider.card" as const;
  return null;
}

/** Detail rows from backend-provided route values only; missing values are omitted. */
export function getCheckoutResultMetadata(result: CheckoutResultParams) {
  const order = result.order_number ?? result.order_id;

  return [
    ...(order ? [{ labelKey: "result.detail.order" as const, value: order, mono: true }] : []),
    ...(result.reference ? [{ labelKey: "result.detail.reference" as const, value: result.reference, mono: true }] : []),
    ...(result.status ? [{ labelKey: "result.detail.status" as const, value: result.status, mono: false }] : []),
  ];
}
