import { withAuthRequired } from "@/components/withAuthRequired";
import { CheckoutPaymentResult } from "@/components/CheckoutPaymentResult";
import { parseCheckoutResultParams, type CheckoutResultSearchParams } from "@/lib/checkoutResultParams";
import { Stack, useLocalSearchParams } from "expo-router";

function CheckoutSuccessScreen() {
  const params = useLocalSearchParams<CheckoutResultSearchParams>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CheckoutPaymentResult outcome="success" result={parseCheckoutResultParams(params)} />
    </>
  );
}

export default withAuthRequired(CheckoutSuccessScreen);
