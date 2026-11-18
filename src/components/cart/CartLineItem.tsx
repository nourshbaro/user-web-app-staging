import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { CartDisplayItem } from "@/lib/cartDisplay";
import { canAdjustQuantity } from "@/lib/cartPresentation";
import { size, spacing } from "@/lib/designTokens";
import { formatLinePrice } from "@/lib/format";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

/** v3 grouped cart card: one surface, hairline rows (one card per match). */
export function CartGroupCard({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[local.group, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
      {title ? (
        <View style={local.groupHeader}>
          <AppText variant="bodyStrong" accessibilityRole="header" numberOfLines={2} style={local.groupTitle}>
            {title}
          </AppText>
        </View>
      ) : null}
      {children}
    </View>
  );
}

/**
 * One cart line (a row inside `CartGroupCard`). Presentation only: every
 * value comes from the cart owner's items (via `groupCartItems`), and the
 * actions call back to the screen, which runs them through
 * `useCartLineActions` / `CartContext`. Nothing here is optimistic: the line
 * changes only when the owner publishes a new cart.
 */
export function CartLineItem({
  line,
  showMatch,
  first = false,
  busy,
  disabled,
  onChangeQuantity,
  onRemove,
}: {
  line: CartDisplayItem;
  /** Show the match title on the line (off when lines are already grouped under a match heading). */
  showMatch: boolean;
  /** First row of its card: no top hairline when there is no group header. */
  first?: boolean;
  /** This line's action is in flight. */
  busy: boolean;
  /** Any cart action is blocked (another line busy, cart check required, expired). */
  disabled: boolean;
  onChangeQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const zone = line.zone_name ?? i18n.t("cart.zoneFallback");
  const seats = line.seats.map((seat) => seat.label ?? `${seat.row}${seat.number}`);
  const adjustable = canAdjustQuantity(line);
  const blocked = disabled || busy;

  return (
    <View
      style={[local.row, !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}
      aria-busy={busy}
    >
      <View style={local.topRow}>
        <View style={local.copy}>
          <AppText variant="body" numberOfLines={2} style={local.zone}>{zone}</AppText>
          {showMatch ? (
            <AppText variant="meta" tone="muted" numberOfLines={2} style={local.regular}>
              {line.match_title ?? i18n.t("cart.matchFallback", { id: line.match_id })}
            </AppText>
          ) : null}
          <AppText variant="meta" tone="muted" style={local.regular}>
            {seats.length
              ? i18n.t("cart.line.seats", { seats: seats.join(", ") })
              : i18n.plural("cart.line.quantity", line.quantity)}
          </AppText>
          <AppText variant="caption" tone="muted" style={local.regular}>
            {i18n.t("cart.line.unitPrice", { price: formatLinePrice(line.unit_price, line.currency) })}
          </AppText>
        </View>
        <View style={local.end}>
          <AppText variant="bodyStrong" style={local.subtotal}>{formatLinePrice(line.subtotal, line.currency)}</AppText>
          <Pressable
            onPress={onRemove}
            disabled={blocked}
            accessibilityRole="button"
            accessibilityLabel={i18n.t("cart.line.removeA11y", { zone })}
            accessibilityState={{ disabled: blocked }}
            aria-disabled={blocked}
            style={({ pressed }) => [local.remove, pressed && !blocked && local.pressed, blocked && local.dimmed]}
          >
            <AppText variant="meta" style={{ color: theme.colors.brandInk }}>{i18n.t("cart.line.remove")}</AppText>
          </Pressable>
        </View>
      </View>

      {adjustable || busy ? (
        <View style={local.actions}>
          {adjustable ? (
            <CartQuantityStepper
              zone={zone}
              quantity={line.quantity}
              disabled={blocked}
              onChange={onChangeQuantity}
            />
          ) : (
            <View />
          )}
          {busy ? (
            <View style={local.busy} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
              <AppText variant="caption" tone="muted">{i18n.t("cart.line.updating")}</AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Quantity control for a GA cart line. Every press asks the owner to set the
 * line to the new quantity; the displayed value is always the published one.
 * The minimum is 1 here: removing a line is the separate Remove action.
 */
function CartQuantityStepper({
  zone,
  quantity,
  disabled,
  onChange,
}: {
  zone: string;
  quantity: number;
  disabled: boolean;
  onChange: (quantity: number) => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const minusDisabled = disabled || quantity <= 1;
  const button = (label: string, enabled: boolean, onPress: () => void, icon: { ios: string; android: string; web: string }) => (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      aria-disabled={!enabled}
      style={({ pressed }) => [local.stepButton, pressed && enabled && local.pressed]}
    >
      <SymbolView
        name={icon as never}
        size={size.iconMd}
        tintColor={enabled ? theme.colors.textStrong : theme.colors.disabledText}
        fallback={<View />}
      />
    </Pressable>
  );
  return (
    <View style={[local.stepper, { backgroundColor: theme.colors.bgAlt }]}>
      {button(i18n.t("tickets.stepper.decrease", { zone }), !minusDisabled, () => onChange(quantity - 1), { ios: "minus", android: "remove", web: "remove" })}
      <AppText variant="bodyStrong" align="center" style={local.value} accessibilityLabel={i18n.plural("tickets.stepper.value", quantity)}>
        {quantity}
      </AppText>
      {button(i18n.t("tickets.stepper.increase", { zone }), !disabled, () => onChange(quantity + 1), { ios: "plus", android: "add", web: "add" })}
    </View>
  );
}

const local = {
  // v3: radius 20 card, 16pt padding, hairline rows.
  group: { borderRadius: 20, overflow: "hidden" as const },
  groupHeader: { paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: spacing.xs },
  groupTitle: { fontSize: 16, lineHeight: 21 },
  row: { paddingHorizontal: spacing.lg, paddingVertical: 14, gap: spacing.sm },
  topRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  zone: { fontWeight: "500" as const },
  regular: { fontWeight: "400" as const },
  end: { flexShrink: 0, alignItems: "flex-end" as const },
  subtotal: { fontVariant: ["tabular-nums" as const] },
  actions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    flexWrap: "wrap" as const,
    gap: spacing.sm,
  },
  busy: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  remove: {
    minHeight: size.touchTargetMin,
    minWidth: size.touchTargetMin,
    alignItems: "flex-end" as const,
    justifyContent: "center" as const,
  },
  pressed: { opacity: 0.6 },
  dimmed: { opacity: 0.45 },
  stepper: { flexDirection: "row" as const, alignItems: "center" as const, borderRadius: 12 },
  stepButton: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  value: { minWidth: 28, fontVariant: ["tabular-nums" as const] },
};
