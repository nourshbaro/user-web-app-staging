import { withAuthRequired } from "@/components/withAuthRequired";
import { CheckoutPaymentResult } from "@/components/CheckoutPaymentResult";
import { parseCheckoutResultParams, type CheckoutResultSearchParams } from "@/lib/checkoutResultParams";
import { invalidatePortalCache } from "@/services/cachedReads";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

function CheckoutSuccessScreen() {
  const params = useLocalSearchParams<CheckoutResultSearchParams>();
  // Reached only after the backend accepted the payment (card 2xx or a BLUE
  // success return): the user's tickets changed, so My Tickets and Home re-read
  // them instead of showing a cached list (they open from this screen).
  useEffect(() => {
    invalidatePortalCache();
  }, []);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <CheckoutPaymentResult outcome="success" result={parseCheckoutResultParams(params)} />
    </>
  );
}

export default withAuthRequired(CheckoutSuccessScreen);
