import { AppText } from "@/components/foundation/AppText";
import { Button, useTheme } from "@/components/ui";
import { layout, size, spacing } from "@/lib/designTokens";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  /** Pre-formatted by the owner (e.g. `formatMoney(cart.total, cart.currency)`). */
  totalLabel?: string;
  totalValue?: string;
  /** Optional pre-formatted count line, e.g. `plural("transaction.ticketCount", n)`. */
  countLabel?: string;
  /**
   * Replaces the total summary at the start of the row (e.g. Match Details'
   * zone name, price and quantity stepper). Rendered as given.
   */
  leading?: ReactNode;
  /** Optional slot above the row (timer, notice) — rendered as given. */
  accessory?: ReactNode;
  /** v3 stacked layout: a full-width action with an optional note below it. */
  stacked?: boolean;
  /** Small muted line under a stacked action. */
  note?: string;
  primaryAction: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    /** Owner's in-flight flag; the bar only reflects it. */
    busy?: boolean;
    accessibilityHint?: string;
    /** Decorative leading glyph (e.g. the v3 lock on "Pay"). */
    icon?: ReactNode;
  };
  /** Adds the bottom safe-area inset when the bar sits at the screen edge. */
  respectSafeArea?: boolean;
};

/**
 * Presentation-only sticky action bar for transactional screens (v3 `--bar`
 * surface with a top hairline). It receives values and callbacks from the
 * existing owner (match draft, cart, holders, checkout) and never reads,
 * stores, recomputes or mutates transaction state.
 */
export function TransactionBar({
  totalLabel,
  totalValue,
  countLabel,
  leading,
  accessory,
  stacked = false,
  note,
  primaryAction,
  respectSafeArea = true,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const button = (
    <Button
      title={primaryAction.label}
      onPress={primaryAction.onPress}
      disabled={primaryAction.disabled}
      loading={primaryAction.busy}
      accessibilityHint={primaryAction.accessibilityHint}
      icon={primaryAction.icon}
    />
  );
  const summary =
    leading ??
    (totalLabel && totalValue ? (
      <View style={local.summary} accessible accessibilityLabel={[totalLabel, totalValue, countLabel].filter(Boolean).join(", ")}>
        <AppText variant="caption" tone="muted" numberOfLines={1}>{totalLabel}</AppText>
        {/* Totals wrap rather than truncate so a long currency string never collides with the action. */}
        <AppText variant="numeric">{totalValue}</AppText>
        {countLabel ? <AppText variant="caption" tone="muted">{countLabel}</AppText> : null}
      </View>
    ) : null);

  return (
    <View
      style={[
        local.bar,
        {
          // v3 --bar is translucent over a backdrop blur; without a native blur an
          // opaque canvas keeps content from showing through the action.
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.hairline,
          paddingBottom: 10 + (respectSafeArea ? insets.bottom : 0),
        },
      ]}
    >
      <View style={local.inner}>
        {accessory}
        {stacked ? (
          <>
            {summary}
            {button}
            {note ? <AppText variant="caption" tone="muted" align="center">{note}</AppText> : null}
          </>
        ) : (
          <View style={local.row}>
            {summary}
            <View style={local.action}>{button}</View>
          </View>
        )}
      </View>
    </View>
  );
}

const local = {
  // v3 bottom bar: padding 12 16 10, gap 12, hairline top.
  bar: {
    width: "100%" as const,
    minHeight: size.transactionBarMinHeight,
    borderTopWidth: 1,
    paddingTop: spacing.md,
    paddingHorizontal: layout.gutter,
  },
  // Matches the transactional screens' readable column on tablets and web.
  inner: { width: "100%" as const, maxWidth: 760, alignSelf: "center" as const, gap: spacing.md },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  summary: { flex: 1, minWidth: 0 },
  action: { flexShrink: 0, minWidth: 140, maxWidth: "60%" as const },
};
