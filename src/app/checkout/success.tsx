import { CheckoutPaymentResult } from "@/components/CheckoutPaymentResult";
import { parseCheckoutResultParams, type CheckoutResultSearchParams } from "@/lib/checkoutResultParams";
import { useLocalSearchParams } from "expo-router";

export default function CheckoutSuccessScreen() {
  const params = useLocalSearchParams<CheckoutResultSearchParams>();
  return <CheckoutPaymentResult outcome="success" result={parseCheckoutResultParams(params)} />;
}
