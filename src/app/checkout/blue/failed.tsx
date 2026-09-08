import { withAuthRequired } from "@/components/withAuthRequired";
import { checkoutResultRouteParams, parseCheckoutResultParams, type CheckoutResultSearchParams } from "@/lib/checkoutResultParams";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";

function BluePaymentFailedScreen() {
  const params = useLocalSearchParams<CheckoutResultSearchParams>();

  useEffect(() => {
    const safeParams = checkoutResultRouteParams(parseCheckoutResultParams({ ...params, provider: "blue" }));
    router.replace({ pathname: "/checkout/failed", params: safeParams });
  }, [params]);

  return null;
}

export default withAuthRequired(BluePaymentFailedScreen);
