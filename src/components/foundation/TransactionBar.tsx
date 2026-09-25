import { AppText } from "@/components/foundation/AppText";
import { Button, useTheme } from "@/components/ui";
import { layout, size, spacing } from "@/lib/designTokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  /** Pre-formatted by the owner (e.g. `formatMoney(cart.total, cart.currency)`). */
  totalLabel: string;
  totalValue: string;
  /** Optional pre-formatted count line, e.g. `plural("transaction.ticketCount", n)`. */
  countLabel?: string;
  /** Optional slot above the row (timer, notice) — rendered as given. */
  accessory?: ReactNode;
  primaryAction: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    /** Owner's in-flight flag; the bar only reflects it. */
    busy?: boolean;
    accessibilityHint?: string;
  };
  /** Adds the bottom safe-area inset when the bar sits at the screen edge. */
  respectSafeArea?: boolean;
};

/**
 * Presentation-only sticky total + primary action for transactional screens.
 * It receives values and callbacks from the existing owner (cart, checkout)
 * and never reads, stores, recomputes or mutates transaction state.
 */
export function TransactionBar({ totalLabel, totalValue, countLabel, accessory, primaryAction, respectSafeArea = true }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        local.bar,
        {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          paddingBottom: spacing.md + (respectSafeArea ? insets.bottom : 0),
        },
      ]}
    >
      {accessory}
      <View style={local.row}>
        <View style={local.summary} accessible accessibilityLabel={[totalLabel, totalValue, countLabel].filter(Boolean).join(", ")}>
          <AppText variant="caption" tone="muted" numberOfLines={1}>{totalLabel}</AppText>
          {/* Totals wrap rather than truncate so a long currency string never collides with the action. */}
          <AppText variant="numeric">{totalValue}</AppText>
          {countLabel ? <AppText variant="caption" tone="muted">{countLabel}</AppText> : null}
        </View>
        <View style={local.action}>
          <Button
            title={primaryAction.label}
            onPress={primaryAction.onPress}
            disabled={primaryAction.disabled}
            loading={primaryAction.busy}
            accessibilityHint={primaryAction.accessibilityHint}
          />
        </View>
      </View>
    </View>
  );
}

const local = {
  bar: {
    width: "100%" as const,
    minHeight: size.transactionBarMinHeight,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    paddingHorizontal: layout.gutter,
    gap: spacing.sm,
  },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  summary: { flex: 1, minWidth: 0 },
  action: { flexShrink: 0, minWidth: 140, maxWidth: "60%" as const },
};
