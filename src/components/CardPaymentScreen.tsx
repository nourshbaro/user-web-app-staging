import { AppHeader } from "@/components/AppHeader";
import { CybersourceUnifiedCheckout } from "@/components/CybersourceUnifiedCheckout";
import { Button, useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import {
  clearCardPaymentHandoff,
  readCardPaymentHandoff,
} from "@/lib/cardPaymentHandoff";
import {
  checkoutResultRouteParams,
  parseCheckoutResultParams,
} from "@/lib/checkoutResultParams";
import { paymentError, userFacingError } from "@/lib/userFacingError";
import { checkoutService } from "@/services/checkout";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function CardPaymentScreen() {
  const theme = useTheme();
  const cart = useCart();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ handoff?: string | string[] }>();
  const handoffId = firstParam(params.handoff) ?? "";
  const [handoff] = useState(() => readCardPaymentHandoff(handoffId));
  const submittingRef = useRef(false);
  const activeRef = useRef(true);
  const [captureContext, setCaptureContext] = useState<string | null>(
    handoff?.captureContext ?? null,
  );
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    handoff ? null : "This card payment session is no longer available.",
  );

  const returnToCheckout = useCallback(() => {
    clearCardPaymentHandoff(handoffId);
    router.dismissTo("/checkout");
  }, [handoffId]);

  useEffect(() => {
    activeRef.current = true;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        returnToCheckout();
        return true;
      },
    );
    return () => {
      activeRef.current = false;
      subscription.remove();
      clearCardPaymentHandoff(handoffId);
    };
  }, [handoffId, returnToCheckout]);

  const preparePayment = useCallback(async (force = false) => {
    if (!handoff || cart.sessionId !== handoff.sessionId) return;
    setPreparationError(null);
    try {
      const context = await handoff.prepareCaptureContext(force);
      if (activeRef.current && cart.sessionId === handoff.sessionId) setCaptureContext(context);
    } catch {
      if (activeRef.current && cart.sessionId === handoff.sessionId) {
        setPreparationError("Unable to load payment. Please try again.");
      }
    }
  }, [cart.sessionId, handoff]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && !captureContext && !preparationError) void preparePayment();
    });
    return () => {
      active = false;
    };
  }, [captureContext, preparationError, preparePayment]);

  const handleSuccess = useCallback(
    async (transientToken: string) => {
      if (
        !handoff ||
        submittingRef.current ||
        cart.sessionId !== handoff.sessionId
      )
        return;
      const cartTicket = cart.captureCartSession();
      if (!cartTicket || cartTicket.sessionId !== handoff.sessionId) return;
      submittingRef.current = true;
      setError(null);
      try {
        const response = await checkoutService.submit({
          ...handoff.request,
          payment: { transient_token: transientToken },
        });
        if (!activeRef.current || !cart.isCartSessionCurrent(cartTicket))
          return;
        const resultParams = checkoutResultRouteParams(
          parseCheckoutResultParams({
            provider: "cybersource",
            order_id: response.order_id,
            order_number: response.order_number,
            reference:
              response.reference ??
              response.payment_reference ??
              response.payment?.reference ??
              response.payment?.payment_reference,
            status: response.status ?? response.payment?.status,
          }),
        );
        const cleared = await cart.clearCartIfSession(cartTicket);
        if (!cleared || !activeRef.current) return;
        clearCardPaymentHandoff(handoffId);
        const resetRouter = router as typeof router & {
          dismissAll?: () => void;
        };
        resetRouter.dismissAll?.();
        router.replace({ pathname: "/checkout/success", params: resultParams });
      } catch (submissionError) {
        if (!activeRef.current || !cart.isCartSessionCurrent(cartTicket))
          return;
        const message = userFacingError(submissionError, paymentError());
        setError(message);
        toast.showToast({
          variant: "error",
          title: "Payment was not completed",
          message,
        });
      } finally {
        submittingRef.current = false;
      }
    },
    [cart, handoff, handoffId, toast],
  );

  return (
    <View
      style={[
        local.root,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: Math.max(insets.top, 14),
        },
      ]}
    >
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <View style={local.header}>
        <AppHeader
          title="Card Payment"
          subtitle="Secure payment"
          hideCart
          showTimer
          onBack={returnToCheckout}
        />
      </View>
      <View style={[local.paymentArea, { paddingBottom: insets.bottom }]}>
        {!handoff || cart.sessionId !== handoff.sessionId || error ? (
          <View style={local.messageArea}>
            <Text style={[local.errorTitle, { color: theme.colors.ink }]}>Payment unavailable</Text>
            <Text style={[local.message, { color: theme.colors.muted }]}>{error ?? "The reservation is no longer active."}</Text>
            <Button title="Back" variant="secondary" onPress={returnToCheckout} />
          </View>
        ) : captureContext ? (
          <CybersourceUnifiedCheckout
            captureContext={captureContext}
            onSuccess={handleSuccess}
            onError={() => {}}
            fullscreen
          />
        ) : preparationError ? (
          <View style={local.messageArea}>
            <Text style={[local.errorTitle, { color: theme.colors.ink }]}>Payment unavailable</Text>
            <Text style={[local.message, { color: theme.colors.muted }]}>{preparationError}</Text>
            <View style={local.errorActions}>
              <Button title="Retry" onPress={() => void preparePayment(true)} />
              <Button title="Back" variant="secondary" onPress={returnToCheckout} />
            </View>
          </View>
        ) : (
          <View style={local.loadingArea}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={[local.loadingText, { color: theme.colors.muted }]}>Loading payment...</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  root: { flex: 1, width: "100%" },
  header: { width: "100%", paddingHorizontal: 14 },
  paymentArea: { flex: 1, width: "100%" },
  messageArea: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingArea: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  errorActions: { width: "100%", maxWidth: 320, gap: 10 },
  errorTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: "900",
    textAlign: "center",
  },
  message: { maxWidth: 420, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
