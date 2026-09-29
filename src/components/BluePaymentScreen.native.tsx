import { AppHeader } from "@/components/AppHeader";
import { AppText, StatePanel } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import {
  clearBluePaymentHandoff,
  clearPendingBluePaymentAttempt,
  readBluePaymentHandoff,
} from "@/lib/bluePaymentHandoff";
import { blueResultDisplayParams, decideBlueNavigation } from "@/lib/bluePaymentRedirect";
import { blueSuccessCompletion } from "@/lib/checkoutFlow";
import { config } from "@/lib/config";
import { markPaymentOutcomeUnknown, settlePaymentAttempt } from "@/lib/paymentOutcomeLock";
import { useI18n } from "@/i18n/I18nProvider";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function BluePaymentScreen() {
  const theme = useTheme();
  const cart = useCart();
  const toast = useToast();
  const alertDialog = useAlertDialog();
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ handoff?: string | string[] }>();
  const handoffId = firstParam(params.handoff) ?? "";
  const [handoff] = useState(() => readBluePaymentHandoff(handoffId));
  const paymentUrl = handoff?.paymentUrl ?? null;
  const terminalHandledRef = useRef(false);
  const activeRef = useRef(true);
  const [loading, setLoading] = useState(Boolean(paymentUrl));
  // Recovery points to My Tickets when a payment may have gone through.
  const [recoverToTickets, setRecoverToTickets] = useState(false);
  const [error, setError] = useState<string | null>(
    paymentUrl ? null : i18n.t("payment.card.sessionGone"),
  );

  // BLUE may be processing remotely when the user leaves, so confirm the
  // navigation. The local reservation deliberately remains active until a
  // trusted success callback or the CartContext expiry authority clears it.
  const confirmLeave = useCallback(() => {
    void alertDialog.showAlert({
      title: i18n.t("payment.blue.leave.title"),
      message: i18n.t("payment.blue.leave.message"),
      variant: "confirm",
      cancelLabel: i18n.t("payment.blue.leave.stay"),
      confirmLabel: i18n.t("payment.blue.leave.confirm"),
    }).then((leave) => {
      if (!leave) return;
      clearBluePaymentHandoff(handoffId);
      router.dismissTo("/checkout");
    });
  }, [alertDialog, handoffId, i18n]);

  useEffect(() => {
    activeRef.current = true;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmLeave();
      return true;
    });
    return () => {
      activeRef.current = false;
      subscription.remove();
      clearBluePaymentHandoff(handoffId);
    };
  }, [confirmLeave, handoffId]);

  const handleTerminal = useCallback(async (terminalUrl: string, result: "success" | "failed") => {
    if (!activeRef.current || terminalHandledRef.current) return;
    terminalHandledRef.current = true;
    const displayParams = blueResultDisplayParams(terminalUrl);
    if (result === "failed") {
      // The provider's failure redirect is the existing definite "not
      // completed" answer (the reservation stays payable), so the attempt's
      // restart record is settled; nothing else changes.
      if (handoff) void settlePaymentAttempt(handoff.sessionId);
      clearBluePaymentHandoff(handoffId);
      toast.showToast({
        variant: "error",
        title: i18n.t("payment.blue.failedToast.title"),
        message: i18n.t("payment.blue.failedToast.message"),
      });
      router.dismissTo("/checkout");
      return;
    }
    const ticket = cart.captureCartSession();
    // The clear is attempted at most once (terminalHandledRef) and only for
    // the handoff's own session; a newer session is never cleared.
    let clear: "cleared" | "notCleared" | "threw" | "notAttempted" = "notAttempted";
    if (handoff && ticket && ticket.sessionId === handoff.sessionId) {
      try {
        clear = (await cart.clearCartIfSession(ticket)) ? "cleared" : "notCleared";
      } catch {
        clear = "threw";
      }
    }
    const completion = blueSuccessCompletion({
      handoffSessionId: handoff?.sessionId ?? null,
      currentSessionId: ticket?.sessionId ?? null,
      clear,
    });
    if (completion !== "success") {
      // Never success, never an automatic retry: the payment may have gone
      // through, so this session's payment stays locked and the user is sent
      // to My Tickets.
      if (completion === "unreconciled" && handoff) markPaymentOutcomeUnknown(handoff.sessionId, "blue");
      if (activeRef.current) {
        setRecoverToTickets(true);
        setError(i18n.t(completion === "unreconciled" ? "payment.blue.unreconciled" : "payment.blue.unmatched"));
      }
      return;
    }
    if (!activeRef.current || !handoff) return;
    clearPendingBluePaymentAttempt(handoff.sessionId);
    clearBluePaymentHandoff(handoffId);
    const resetRouter = router as typeof router & { dismissAll?: () => void };
    resetRouter.dismissAll?.();
    router.replace({
      pathname: "/checkout/success",
      params: { provider: "blue", ...displayParams },
    });
  }, [cart, handoff, handoffId, i18n, toast]);

  const handleNavigation = useCallback((request: WebViewNavigation) => {
    const navigationUrl = request.url;
    const navigationDecision = decideBlueNavigation(
      navigationUrl,
      config.blueRedirectOrigin,
      terminalHandledRef.current,
    );
    const { terminalResult } = navigationDecision;

    if (navigationDecision.action === "ignore") {
      return false;
    }

    if (navigationDecision.action === "handle_terminal" && terminalResult) {
      void handleTerminal(navigationUrl, terminalResult).catch(() => {
        // Defensive: any unexpected failure is a recovery state, never success.
        if (activeRef.current) {
          setRecoverToTickets(true);
          setError(i18n.t("payment.blue.unreconciled"));
        }
      });
      return false;
    }

    if (navigationDecision.decision === "invalid_url") {
      setError(i18n.t("payment.blue.invalidAddress"));
      return false;
    }

    if (navigationDecision.decision === "blocked_credentials") {
      setError(i18n.t("payment.blue.unsafeAddress"));
      return false;
    }
    if (navigationDecision.action === "allow_webview") {
      return true;
    }

    if (navigationDecision.action === "open_external") {
      const externalUrl = new URL(navigationUrl);
      void Linking.canOpenURL(externalUrl.href)
        .then((supported) => {
          if (!supported) {
            return;
          }
          return Linking.openURL(externalUrl.href);
        })
        .catch(() => {
          setError(i18n.t("payment.blue.externalUnavailable"));
        });
      return false;
    }

    if (navigationDecision.decision === "blocked_dangerous_scheme") {
      setError(i18n.t("payment.blue.unsupportedAction"));
      return false;
    }

    setError(i18n.t("payment.blue.unsupportedApp"));
    return false;
  }, [handleTerminal, i18n]);

  const handleShouldStart = useCallback(
    (request: WebViewNavigation) => handleNavigation(request),
    [handleNavigation],
  );

  const showUnavailable = (message: string) => {
    setLoading(false);
    setError(message);
  };

  return (
    <View
      style={[
        local.screen,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
          animation: "none",
        }}
      />

      <View style={local.header}>
        <AppHeader title={i18n.t("payment.blue.title")} subtitle={i18n.t("payment.secure")} hideCart showTimer onBack={confirmLeave} />
      </View>

      <View style={local.paymentArea}>
        {paymentUrl && !error ? (
          <WebView
          source={{ uri: paymentUrl }}
          originWhitelist={["*"]}
          javaScriptEnabled
          mixedContentMode="never"
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={handleShouldStart}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => showUnavailable(i18n.t("payment.blue.pageFailed"))}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 400) {
              showUnavailable(i18n.t("payment.blue.pageError"));
            }
          }}
          onRenderProcessGone={() => showUnavailable(i18n.t("payment.blue.rendererStopped"))}
          onContentProcessDidTerminate={() => showUnavailable(i18n.t("payment.blue.rendererStopped"))}
          style={local.webView}
          />
        ) : null}

        {loading && !error ? (
          <View
            style={[local.overlay, { backgroundColor: theme.colors.surface }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${i18n.t("payment.blue.loading.title")}. ${i18n.t("payment.blue.loading.message")}`}
            aria-busy
          >
            <ActivityIndicator color={theme.colors.actionPrimary} />
            <AppText variant="cardTitle" align="center" style={local.loadingTitle}>{i18n.t("payment.blue.loading.title")}</AppText>
            <AppText variant="meta" tone="muted" align="center">{i18n.t("payment.blue.loading.message")}</AppText>
          </View>
        ) : null}

        {error ? (
          <View style={[local.overlay, { backgroundColor: theme.colors.bg }]}>
            <StatePanel
              variant={recoverToTickets ? "info" : "error"}
              title={recoverToTickets ? i18n.t("payment.unknown.title") : i18n.t("payment.unavailable.title")}
              message={recoverToTickets ? error : `${error} ${i18n.t("payment.blue.reservationNote")}`}
              action={
                recoverToTickets
                  ? {
                      label: i18n.t("payment.viewTickets"),
                      onPress: () => {
                        clearBluePaymentHandoff(handoffId);
                        router.replace("/tickets");
                      },
                    }
                  : {
                      label: i18n.t("payment.blue.return"),
                      onPress: () => {
                        clearBluePaymentHandoff(handoffId);
                        router.dismissTo("/checkout");
                      },
                    }
              }
              secondaryAction={
                recoverToTickets
                  ? {
                      label: i18n.t("payment.blue.return"),
                      onPress: () => {
                        clearBluePaymentHandoff(handoffId);
                        router.dismissTo("/checkout");
                      },
                    }
                  : undefined
              }
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 14 },
  paymentArea: { flex: 1 },
  webView: { flex: 1, backgroundColor: "#FFFFFF" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: 28, alignItems: "center", justifyContent: "center" },
  loadingTitle: { marginTop: 14 },
});
