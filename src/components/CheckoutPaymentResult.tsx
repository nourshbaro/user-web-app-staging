import { Button, Card, Screen, styles, useResponsive, useTheme } from "@/components/ui";
import type { CheckoutResultParams } from "@/lib/checkoutResultParams";
import {
  getCheckoutResultMetadata,
  getCheckoutResultPresentation,
  type CheckoutResultOutcome,
} from "@/lib/checkoutResultPresentation";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, ScrollView, Text, View } from "react-native";

type Props = {
  outcome: CheckoutResultOutcome;
  result: CheckoutResultParams;
};

export function CheckoutPaymentResult({ outcome, result }: Props) {
  const theme = useTheme();
  const responsive = useResponsive();
  const succeeded = outcome === "success";
  const presentation = getCheckoutResultPresentation(outcome, result.provider);
  const metadata = getCheckoutResultMetadata(result);
  const announcedResultRef = useRef<string | null>(null);

  useEffect(() => {
    const announcementKey = `${outcome}:${result.provider}`;
    if (announcedResultRef.current === announcementKey) return;
    announcedResultRef.current = announcementKey;
    AccessibilityInfo.announceForAccessibility(presentation.title);
  }, [outcome, presentation.title, result.provider]);

  return (
    <Screen>
      <ScrollView
        style={[local.scroll, { width: responsive.contentWidth }]}
        contentContainerStyle={local.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={local.cardWrap}>
          <Card>
            <View
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[local.icon, { backgroundColor: succeeded ? theme.colors.success : theme.colors.danger }]}
            >
              <Text accessible={false} style={local.iconText}>{succeeded ? "✓" : "!"}</Text>
            </View>
            <Text accessibilityRole="header" style={[local.title, { color: theme.colors.ink }]}>
              {presentation.title}
            </Text>
            <Text style={[local.message, { color: theme.colors.secondary }]}>{presentation.message}</Text>

            {result.reasonMessage ? (
              <Text accessibilityRole="alert" style={[local.reason, { color: theme.colors.secondary }]}>
                {result.reasonMessage}
              </Text>
            ) : null}

            {metadata.map((detail) => <ResultDetail key={detail.label} {...detail} />)}

            <View style={local.actions}>
              <Button title="Return home" onPress={() => router.replace("/")} />
              <Button
                title={presentation.secondaryAction.title}
                variant="secondary"
                onPress={() => router.replace(presentation.secondaryAction.href)}
              />
            </View>
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

function ResultDetail({ label, value }: { label: string; value: string }) {
  const theme = useTheme();

  return (
    <View style={[local.detail, { backgroundColor: theme.colors.panelSoft, borderColor: theme.colors.line }]}>
      <Text style={[styles.muted, local.detailLabel]}>{label}</Text>
      <Text style={[local.detailValue, { color: theme.colors.ink }]}>{value}</Text>
    </View>
  );
}

const local = {
  scroll: { flex: 1, maxWidth: 560, alignSelf: "center" as const },
  content: { flexGrow: 1, justifyContent: "center" as const, paddingTop: 18, paddingBottom: 24 },
  cardWrap: { width: "100%" as const },
  icon: { width: 52, height: 52, borderRadius: 26, alignSelf: "center" as const, alignItems: "center" as const, justifyContent: "center" as const },
  iconText: { color: "#FFFFFF", fontSize: 27, lineHeight: 32, fontWeight: "900" as const },
  title: { marginTop: 2, fontSize: 24, lineHeight: 31, fontWeight: "900" as const, textAlign: "center" as const },
  message: { fontSize: 14, lineHeight: 21, textAlign: "center" as const },
  reason: { fontSize: 13, lineHeight: 19, textAlign: "center" as const },
  detail: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  detailLabel: { textTransform: "uppercase" as const, fontWeight: "800" as const },
  detailValue: { fontSize: 14, lineHeight: 20, fontWeight: "800" as const },
  actions: { marginTop: 2, gap: 10 },
};
