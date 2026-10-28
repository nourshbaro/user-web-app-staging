import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { motion, spacing } from "@/lib/designTokens";
import { SymbolView } from "expo-symbols";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Platform, View } from "react-native";

/**
 * How a payment outcome is presented. The caller decides the variant from
 * production's own terminal state; this component never infers one:
 * - `success`: a trusted, matched completion (the cart was already cleared).
 * - `failed`: a definite non-completion reported by the provider/backend.
 * - `unknown`: no trustworthy answer — the order may exist; stays locked.
 * - `unavailable`: the payment could not be started or shown.
 */
export type PaymentOutcomeVariant = "success" | "failed" | "unknown" | "unavailable";

type Action = { label: string; onPress: () => void };

const ICONS: Record<Exclude<PaymentOutcomeVariant, "success">, { ios: string; android: string; web: string }> = {
  failed: { ios: "exclamationmark.circle", android: "error_outline", web: "error_outline" },
  unknown: { ios: "questionmark.circle", android: "help_outline", web: "help_outline" },
  unavailable: { ios: "exclamationmark.circle", android: "error_outline", web: "error_outline" },
};

/** v3 92pt result mark: a soft circle with the outcome glyph. Decorative. */
export function PaymentOutcomeIcon({ variant }: { variant: PaymentOutcomeVariant }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(reducedMotion ? 1 : 0.6));

  useEffect(() => {
    if (reducedMotion) {
      scale.setValue(1);
      return;
    }
    // v3 popIn: a short settle; nothing waits on it.
    Animated.timing(scale, { toValue: 1, duration: motion.enter, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true }).start();
  }, [reducedMotion, scale]);

  const success = theme.colors.tones.success;
  const danger = theme.colors.tones.danger;
  const soft = variant === "success" ? success.bg : variant === "unknown" ? theme.colors.bgAlt : danger.bg;

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[local.icon, { backgroundColor: soft, transform: [{ scale }] }]}
    >
      {variant === "success" ? (
        <View style={[local.okDisc, { backgroundColor: success.fg }]}>
          <SymbolView
            name={{ ios: "checkmark", android: "check", web: "check" }}
            size={30}
            tintColor="#FFFFFF"
            fallback={<AppText variant="displayNumeral" style={{ color: "#FFFFFF" }}>✓</AppText>}
          />
        </View>
      ) : (
        <SymbolView
          name={ICONS[variant] as never}
          size={40}
          tintColor={variant === "unknown" ? theme.colors.textStrong : danger.fg}
          fallback={<AppText variant="displayNumeral" style={{ color: danger.fg }}>{variant === "unknown" ? "?" : "!"}</AppText>}
        />
      )}
    </Animated.View>
  );
}

/**
 * v3 payment outcome layout (paid / couldn't confirm / didn't go through):
 * result mark, display title, message, optional detail card, and stacked
 * actions. Values and actions come from the owning screen.
 */
export function PaymentOutcomePanel({
  variant,
  title,
  message,
  children,
  action,
  secondaryAction,
  secondaryStyle = "tonal",
}: {
  variant: PaymentOutcomeVariant;
  title: string;
  message: string;
  /** Detail card (order fields, numbered steps) rendered under the message. */
  children?: ReactNode;
  action?: Action;
  secondaryAction?: Action;
  /** v3: `tonal` (--bg2 button) or `ghost` (text button, e.g. "Back to home"). */
  secondaryStyle?: "tonal" | "ghost";
}) {
  return (
    <View style={local.panel}>
      <View style={local.top}>
        <PaymentOutcomeIcon variant={variant} />
        <AppText variant="displayPrompt" align="center" accessibilityRole="header" style={local.title}>
          {title}
        </AppText>
        <AppText variant="body" tone="muted" align="center">{message}</AppText>
        {children}
      </View>
      <View style={local.actions}>
        {action ? <Button title={action.label} onPress={action.onPress} /> : null}
        {secondaryAction ? (
          <Button title={secondaryAction.label} variant={secondaryStyle} onPress={secondaryAction.onPress} />
        ) : null}
      </View>
    </View>
  );
}

/** v3 "couldn't confirm" guidance: two numbered steps. */
export function UnknownOutcomeSteps() {
  const theme = useTheme();
  const i18n = useI18n();
  const steps = [i18n.t("payment.unknown.step1"), i18n.t("payment.unknown.step2")];
  return (
    <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
      {steps.map((step, index) => (
        <View key={step} style={[local.step, index > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}>
          <View style={[local.stepNumber, { backgroundColor: theme.colors.bgAlt }]}>
            <AppText variant="label" style={local.stepDigit}>{index + 1}</AppText>
          </View>
          <AppText variant="body" style={local.stepText}>{step}</AppText>
        </View>
      ))}
    </View>
  );
}

/** v3 result detail card: label / value rows (backend-provided values only). */
export function OutcomeDetails({ rows }: { rows: { label: string; value: string; mono?: boolean }[] }) {
  const theme = useTheme();
  if (!rows.length) return null;
  return (
    <View style={[local.card, local.details, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[local.detailRow, index > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}
          accessible
          accessibilityLabel={`${row.label}: ${row.value}`}
        >
          <AppText variant="body" tone="muted">{row.label}</AppText>
          <AppText
            variant="bodyStrong"
            numberOfLines={2}
            style={[local.detailValue, row.mono ? [local.mono, { writingDirection: "ltr" }] : null]}
          >
            {row.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const local = {
  panel: {
    flexGrow: 1,
    width: "100%" as const,
    maxWidth: 560,
    alignSelf: "center" as const,
    gap: spacing.xl,
    justifyContent: "space-between" as const,
  },
  top: { alignItems: "stretch" as const, gap: spacing.sm, paddingTop: spacing.xxxl },
  // v3: 92pt soft circle; success nests a 60pt solid disc.
  icon: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignSelf: "center" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: spacing.lg,
  },
  okDisc: { width: 60, height: 60, borderRadius: 30, alignItems: "center" as const, justifyContent: "center" as const },
  title: { marginBottom: 2 },
  actions: { gap: 10 },
  card: { borderRadius: 20, overflow: "hidden" as const, marginTop: spacing.lg },
  details: { paddingHorizontal: spacing.lg },
  step: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const },
  stepDigit: { fontWeight: "600" as const },
  stepText: { flex: 1, minWidth: 0, fontWeight: "500" as const },
  detailRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  detailValue: { flexShrink: 1 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontWeight: "500" as const, fontSize: 14 },
};
