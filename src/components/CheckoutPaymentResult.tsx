import { Button, Card, Screen, styles, useResponsive, useTheme } from "@/components/ui";
import type { CheckoutResultParams } from "@/lib/checkoutResultParams";
import { router } from "expo-router";
import { Text, View } from "react-native";

type Props = {
  outcome: "success" | "failed";
  result: CheckoutResultParams;
};

export function CheckoutPaymentResult({ outcome, result }: Props) {
  const theme = useTheme();
  const responsive = useResponsive();
  const succeeded = outcome === "success";
  const order = result.order_number ?? result.order_id;
  const copy = resultCopy(outcome, result.provider);

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <Card>
          <View style={[local.icon, { backgroundColor: succeeded ? theme.colors.success : theme.colors.danger }]}>
            <Text style={local.iconText}>{succeeded ? "✓" : "!"}</Text>
          </View>
          <Text accessibilityRole="header" style={[local.title, { color: theme.colors.ink }]}>
            {copy.title}
          </Text>
          <Text style={[local.message, { color: theme.colors.secondary }]}>{copy.message}</Text>

          {result.reasonMessage ? (
            <Text accessibilityRole="alert" style={[local.reason, { color: theme.colors.secondary }]}>
              {result.reasonMessage}
            </Text>
          ) : null}

          {order ? <ResultDetail label="Order" value={order} /> : null}
          {result.reference ? <ResultDetail label="Reference" value={result.reference} /> : null}
          {result.status ? <ResultDetail label="Status" value={result.status} /> : null}

          <Button title="Return home" onPress={() => router.replace("/")} />
          {succeeded ? (
            <Button title="View bookings" variant="secondary" onPress={() => router.replace("/profile")} />
          ) : (
            <Button title="Browse matches" variant="secondary" onPress={() => router.replace("/matches")} />
          )}
        </Card>
      </View>
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

function resultCopy(outcome: Props["outcome"], provider: CheckoutResultParams["provider"]) {
  if (outcome === "success") {
    if (provider === "blue") {
      return {
        title: "Blue Wallet payment successful",
        message: "Your booking has been confirmed. You can find your tickets and booking details in your profile.",
      };
    }
    if (provider === "cybersource") {
      return {
        title: "Card payment successful",
        message: "Your booking has been confirmed. You can find your tickets and booking details in your profile.",
      };
    }
    return {
      title: "Payment successful",
      message: "Your payment result is ready. View your profile for authoritative booking details.",
    };
  }

  if (provider === "blue") {
    return {
      title: "Blue Wallet payment failed",
      message: "Blue Wallet could not complete this payment. The previous checkout is no longer active, so a new attempt must begin with a new reservation.",
    };
  }
  if (provider === "cybersource") {
    return {
      title: "Card payment failed",
      message: "The card payment could not be completed. Return home or browse matches to begin a safe new attempt.",
    };
  }
  return {
    title: "Payment failed",
    message: "The payment could not be completed. Return home or browse matches to continue safely.",
  };
}

const local = {
  shell: { flex: 1, maxWidth: 560, alignSelf: "center" as const, justifyContent: "center" as const },
  icon: { width: 58, height: 58, borderRadius: 29, alignSelf: "center" as const, alignItems: "center" as const, justifyContent: "center" as const },
  iconText: { color: "#FFFFFF", fontSize: 30, lineHeight: 36, fontWeight: "900" as const },
  title: { marginTop: 4, fontSize: 25, lineHeight: 32, fontWeight: "900" as const, textAlign: "center" as const },
  message: { fontSize: 14, lineHeight: 21, textAlign: "center" as const },
  reason: { fontSize: 13, lineHeight: 19, textAlign: "center" as const },
  detail: { borderWidth: 1, borderRadius: 13, padding: 12, gap: 2 },
  detailLabel: { textTransform: "uppercase" as const, fontWeight: "800" as const },
  detailValue: { fontSize: 14, lineHeight: 20, fontWeight: "800" as const },
};
