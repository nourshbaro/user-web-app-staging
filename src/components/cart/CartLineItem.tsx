import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import type { CartDisplayItem } from "@/lib/cartDisplay";
import { canAdjustQuantity } from "@/lib/cartPresentation";
import { radius, size, spacing } from "@/lib/designTokens";
import { formatMoney } from "@/lib/format";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Pressable, View } from "react-native";

/**
 * One cart line. Presentation only: every value comes from the cart owner's
 * items (via `groupCartItems`), and the actions call back to the screen, which
 * runs them through `useCartLineActions` / `CartContext`. Nothing here is
 * optimistic: the line changes only when the owner publishes a new cart.
 */
export function CartLineItem({
  line,
  showMatch,
  busy,
  disabled,
  onChangeQuantity,
  onRemove,
}: {
  line: CartDisplayItem;
  /** Show the match title on the line (off when lines are already grouped under a match heading). */
  showMatch: boolean;
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
      style={[local.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
      aria-busy={busy}
    >
      <View style={local.topRow}>
        <View style={local.copy}>
          <AppText variant="cardTitle" numberOfLines={2}>{zone}</AppText>
          {showMatch ? (
            <AppText variant="meta" tone="muted" numberOfLines={2}>
              {line.match_title ?? i18n.t("cart.matchFallback", { id: line.match_id })}
            </AppText>
          ) : null}
          <AppText variant="meta" tone="muted">
            {seats.length
              ? i18n.t("cart.line.seats", { seats: seats.join(", ") })
              : i18n.plural("cart.line.quantity", line.quantity)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {i18n.t("cart.line.unitPrice", { price: formatMoney(line.unit_price, line.currency) })}
          </AppText>
        </View>
        <AppText variant="numeric" style={local.subtotal}>{formatMoney(line.subtotal, line.currency)}</AppText>
      </View>

      <View style={[local.actions, { borderTopColor: theme.colors.divider }]}>
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
        <View style={local.end}>
          {busy ? (
            <View style={local.busy} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
              <AppText variant="caption" tone="muted">{i18n.t("cart.line.updating")}</AppText>
            </View>
          ) : null}
          <Pressable
            onPress={onRemove}
            disabled={blocked}
            accessibilityRole="button"
            accessibilityLabel={i18n.t("cart.line.removeA11y", { zone })}
            accessibilityState={{ disabled: blocked }}
            aria-disabled={blocked}
            style={({ pressed }) => [local.remove, pressed && !blocked && local.pressed, blocked && local.dimmed]}
          >
            <SymbolView
              name={{ ios: "trash", android: "delete", web: "delete" }}
              size={size.iconSm}
              tintColor={theme.colors.tones.danger.fg}
              fallback={<View />}
            />
            <AppText variant="label" tone="danger">{i18n.t("cart.line.remove")}</AppText>
          </Pressable>
        </View>
      </View>
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
      style={({ pressed }) => [
        local.stepButton,
        { borderColor: theme.colors.border, backgroundColor: enabled ? theme.colors.surface : theme.colors.disabledSurface },
        pressed && enabled && local.pressed,
      ]}
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
    <View style={local.stepper}>
      {button(i18n.t("tickets.stepper.decrease", { zone }), !minusDisabled, () => onChange(quantity - 1), { ios: "minus", android: "remove", web: "remove" })}
      <AppText variant="numeric" align="center" style={local.value} accessibilityLabel={i18n.plural("tickets.stepper.value", quantity)}>
        {quantity}
      </AppText>
      {button(i18n.t("tickets.stepper.increase", { zone }), !disabled, () => onChange(quantity + 1), { ios: "plus", android: "add", web: "add" })}
    </View>
  );
}

const local = {
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  topRow: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  subtotal: { flexShrink: 0 },
  actions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    flexWrap: "wrap" as const,
    gap: spacing.sm,
    borderTopWidth: 1,
    paddingTop: spacing.md,
  },
  end: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, marginStart: "auto" as const },
  busy: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  remove: {
    minHeight: size.touchTargetMin,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  pressed: { opacity: 0.75 },
  dimmed: { opacity: 0.45 },
  stepper: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  stepButton: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  value: { minWidth: 32 },
};
