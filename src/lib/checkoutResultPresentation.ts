import type { CheckoutResultParams } from "@/lib/checkoutResultParams";

export type CheckoutResultOutcome = "success" | "failed";

export function getCheckoutResultPresentation(
  outcome: CheckoutResultOutcome,
  provider: CheckoutResultParams["provider"],
) {
  if (outcome === "success") {
    if (provider === "blue") {
      return {
        title: "Blue Wallet payment successful",
        message: "Your booking has been confirmed. Your ticket(s) have been sent to your email.",
        secondaryAction: { title: "View tickets", href: "/profile" as const },
      };
    }
    if (provider === "cybersource") {
      return {
        title: "Card payment successful",
        message: "Your booking has been confirmed. Your ticket(s) have been sent to your email.",
        secondaryAction: { title: "View tickets", href: "/profile" as const },
      };
    }
    return {
      title: "Payment successful",
      message: "Your payment result is ready. Your ticket(s) have been sent to your email.",
      secondaryAction: { title: "View tickets", href: "/profile" as const },
    };
  }

  if (provider === "blue") {
    return {
      title: "Blue Wallet payment failed",
      message: "Blue Wallet could not complete this payment. The previous checkout is no longer active, so a new attempt must begin with a new reservation.",
      secondaryAction: { title: "Browse matches", href: "/matches" as const },
    };
  }
  if (provider === "cybersource") {
    return {
      title: "Card payment failed",
      message: "The card payment could not be completed. Return home or browse matches to begin a safe new attempt.",
      secondaryAction: { title: "Browse matches", href: "/matches" as const },
    };
  }
  return {
    title: "Payment failed",
    message: "The payment could not be completed. Return home or browse matches to continue safely.",
    secondaryAction: { title: "Browse matches", href: "/matches" as const },
  };
}

export function getCheckoutResultMetadata(result: CheckoutResultParams) {
  const order = result.order_number ?? result.order_id;

  return [
    ...(order ? [{ label: "Order", value: order }] : []),
    ...(result.reference ? [{ label: "Reference", value: result.reference }] : []),
    ...(result.status ? [{ label: "Status", value: result.status }] : []),
  ];
}
