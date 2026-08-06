import { CheckoutPaymentResult } from "@/components/CheckoutPaymentResult";
import { parseCheckoutResultParams, type CheckoutResultSearchParams } from "@/lib/checkoutResultParams";
import { Stack, useLocalSearchParams } from "expo-router";

export default function CheckoutFailedScreen() {
  const params = useLocalSearchParams<CheckoutResultSearchParams>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CheckoutPaymentResult outcome="failed" result={parseCheckoutResultParams(params)} />
    </>
  );
}
