import { OutcomeDetails, PaymentOutcomePanel } from "@/components/checkout/PaymentOutcome";
import { AppText } from "@/components/foundation";
import { useResponsive, useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { CheckoutResultParams } from "@/lib/checkoutResultParams";
import {
  getCheckoutResultMetadata,
  getCheckoutResultPresentation,
  getCheckoutResultProviderKey,
  purchasedTicketsAction,
  type CheckoutResultOutcome,
} from "@/lib/checkoutResultPresentation";
import { spacing } from "@/lib/designTokens";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  outcome: CheckoutResultOutcome;
  result: CheckoutResultParams;
};

/**
 * v3 payment result (paid / didn't go through). Display only: the outcome is
 * decided by the production flow that routed here, and every detail row is a
 * backend-provided route value (missing ones are omitted, never invented).
 */
export function CheckoutPaymentResult({ outcome, result }: Props) {
  const theme = useTheme();
  const i18n = useI18n();
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();
  const succeeded = outcome === "success";
  const presentation = getCheckoutResultPresentation(outcome);
  const ticketsAction = purchasedTicketsAction(result);
  const title = i18n.t(presentation.titleKey);
  const providerKey = getCheckoutResultProviderKey(result.provider);
  const rows = [
    ...getCheckoutResultMetadata(result).map((row) => ({ label: i18n.t(row.labelKey), value: row.value, mono: row.mono })),
    ...(succeeded && providerKey ? [{ label: i18n.t("result.detail.paidWith"), value: i18n.t(providerKey) }] : []),
  ];
  const announcedResultRef = useRef<string | null>(null);

  useEffect(() => {
    const announcementKey = `${outcome}:${result.provider}`;
    if (announcedResultRef.current === announcementKey) return;
    announcedResultRef.current = announcementKey;
    AccessibilityInfo.announceForAccessibility(title);
  }, [outcome, title, result.provider]);

  return (
    <View style={[local.root, { backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <ScrollView
        style={[local.scroll, { width: responsive.contentWidth }]}
        contentContainerStyle={local.content}
        showsVerticalScrollIndicator={false}
      >
        <PaymentOutcomePanel
          variant={succeeded ? "success" : "failed"}
          title={title}
          message={i18n.t(presentation.messageKey)}
          action={
            succeeded
              ? {
                  label: i18n.t(ticketsAction.labelKey),
                  onPress: () => router.replace(ticketsAction.href),
                }
              : {
                  label: i18n.t(presentation.primaryAction.labelKey),
                  onPress: () => router.replace(presentation.primaryAction.href),
                }
          }
          secondaryAction={{
            label: i18n.t(presentation.secondaryAction.labelKey),
            onPress: () => router.replace("/"),
          }}
          secondaryStyle="ghost"
        >
          {result.reasonMessage ? (
            <AppText variant="meta" tone="muted" align="center" accessibilityRole="alert">
              {result.reasonMessage}
            </AppText>
          ) : null}
          <OutcomeDetails rows={rows} />
        </PaymentOutcomePanel>
      </ScrollView>
    </View>
  );
}

const local = {
  root: { flex: 1, alignItems: "center" as const },
  scroll: { flex: 1, maxWidth: 560, alignSelf: "center" as const },
  content: { flexGrow: 1, justifyContent: "center" as const, paddingTop: 18, paddingBottom: 8 },
};
