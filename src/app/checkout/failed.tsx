import { CheckoutPaymentResult } from "@/components/CheckoutPaymentResult";
import { parseCheckoutResultParams, type CheckoutResultSearchParams } from "@/lib/checkoutResultParams";
import { useLocalSearchParams } from "expo-router";

export default function CheckoutFailedScreen() {
  const params = useLocalSearchParams<CheckoutResultSearchParams>();
  return <CheckoutPaymentResult outcome="failed" result={parseCheckoutResultParams(params)} />;
}
