import { AppText, DirectionalChevron } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, size, spacing } from "@/lib/designTokens";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

/*
 * Presentation-only ticket option pieces for Match Details. They render
 * values and call back into the screen; they never read the cart, fetch, or
 * hold selection state. The screen (and, for committed state, CartContext)
 * owns everything they show.
 */

type ZoneOptionCardProps = {
  name: string;
  kindLabel: string;
  priceLabel: string;
  unitLabel: string;
  capacityLabel?: string | null;
  /** Map legend colour for this zone (links the card to its polygon). Decorative. */
  legendColor: string;
  selected: boolean;
  /** Reserved zones: the whole card is one button. GA zones: only the details area is. */
  pressTarget: "card" | "details";
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Trailing control: GA stepper or reserved-seat status. */
  end: ReactNode;
  /** Optional line under the row (e.g. in-cart quantity, subtotal). */
  footer?: ReactNode;
};

export function ZoneOptionCard({
  name,
  kindLabel,
  priceLabel,
  unitLabel,
  capacityLabel,
  legendColor,
  selected,
  pressTarget,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  end,
  footer,
}: ZoneOptionCardProps) {
  const theme = useTheme();
  const brand = theme.colors.tones.brand;

  const details = (
    <View style={local.details}>
      <AppText variant="cardTitle" numberOfLines={2}>{name}</AppText>
      <View style={local.metaRow}>
        <View style={[local.kindPill, { backgroundColor: theme.colors.surfaceSecondary }]}>
          <SymbolView
            name={
              (pressTarget === "card"
                ? { ios: "chair", android: "event_seat", web: "event_seat" }
                : { ios: "person.2", android: "groups", web: "groups" }) as never
            }
            size={size.iconSm - 2}
            tintColor={theme.colors.textMuted}
            fallback={<View />}
          />
          <AppText variant="caption" tone="muted" numberOfLines={1}>{kindLabel}</AppText>
        </View>
        {capacityLabel ? <AppText variant="caption" tone="muted" numberOfLines={1}>{capacityLabel}</AppText> : null}
      </View>
      <View style={local.priceRow}>
        <AppText variant="numeric">{priceLabel}</AppText>
        <AppText variant="caption" tone="muted">{unitLabel}</AppText>
      </View>
    </View>
  );

  const cardStyle = [
    local.card,
    {
      backgroundColor: selected ? theme.colors.selectedSurface : theme.colors.surface,
      borderColor: selected ? brand.fg : theme.colors.border,
      borderWidth: selected ? 2 : 1,
    },
  ];

  const stripe = <View style={[local.stripe, { backgroundColor: legendColor }]} />;

  if (pressTarget === "card") {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ selected }}
        aria-selected={selected}
        style={({ pressed }) => [cardStyle, pressed && local.pressed]}
      >
        <View style={local.row}>
          {stripe}
          {details}
          <View style={local.end}>{end}</View>
        </View>
        {footer}
      </Pressable>
    );
  }

  return (
    <View style={cardStyle}>
      <View style={local.row}>
        {stripe}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ selected }}
          aria-selected={selected}
          style={({ pressed }) => [local.detailsPress, pressed && local.pressed]}
        >
          {details}
        </Pressable>
        <View style={local.end}>{end}</View>
      </View>
      {footer}
    </View>
  );
}

/**
 * "− quantity +" control for a general-admission zone. Pure presentation of
 * the screen's draft quantity: both buttons call straight back to the
 * screen's draft setters. No request and no cart mutation happens here; the
 * screen's single confirmation action is what reaches CartContext. Minus is
 * disabled at zero so the draft can never go negative.
 */
export function GaZoneStepper({
  zoneName,
  quantity,
  disabled,
  onIncrement,
  onDecrement,
}: {
  zoneName: string;
  quantity: number;
  disabled: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const minusDisabled = disabled || quantity <= 0;

  return (
    <View style={local.stepper}>
      <Pressable
        onPress={onDecrement}
        disabled={minusDisabled}
        accessibilityRole="button"
        accessibilityLabel={i18n.t("tickets.stepper.decrease", { zone: zoneName })}
        accessibilityState={{ disabled: minusDisabled }}
        aria-disabled={minusDisabled}
        style={({ pressed }) => [
          local.stepperButton,
          { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
          minusDisabled && { backgroundColor: theme.colors.disabledSurface, borderColor: theme.colors.disabledSurface },
          pressed && !minusDisabled && local.pressed,
        ]}
      >
        <SymbolView
          name={{ ios: "minus", android: "remove", web: "remove" }}
          size={size.iconMd}
          tintColor={minusDisabled ? theme.colors.disabledText : theme.colors.textStrong}
          fallback={<View />}
        />
      </Pressable>
      <View style={local.stepperValue}>
        <AppText
          variant="numeric"
          align="center"
          accessibilityLabel={i18n.plural("tickets.stepper.value", quantity)}
          accessibilityLiveRegion="polite"
        >
          {quantity}
        </AppText>
      </View>
      <Pressable
        onPress={onIncrement}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={i18n.t("tickets.stepper.increase", { zone: zoneName })}
        accessibilityState={{ disabled }}
        aria-disabled={disabled}
        style={({ pressed }) => [
          local.stepperButton,
          { borderColor: theme.colors.actionPrimary, backgroundColor: theme.colors.actionPrimary },
          disabled && { backgroundColor: theme.colors.disabledSurface, borderColor: theme.colors.disabledSurface },
          pressed && !disabled && { backgroundColor: theme.colors.actionPrimaryPressed },
        ]}
      >
        <SymbolView
          name={{ ios: "plus", android: "add", web: "add" }}
          size={size.iconMd}
          tintColor={disabled ? theme.colors.disabledText : theme.colors.onActionPrimary}
          fallback={<View />}
        />
      </Pressable>
    </View>
  );
}

/**
 * Status shown at the end of a reserved-seating zone card. Display only: the
 * card itself is the button that selects the zone.
 */
export function ReservedZoneStatus({
  selected,
  pendingCount,
  inCartCount,
}: {
  selected: boolean;
  pendingCount: number;
  inCartCount: number;
}) {
  const theme = useTheme();
  const i18n = useI18n();

  if (pendingCount > 0) {
    return <StatusChip tone="brand" label={i18n.plural("tickets.selected", pendingCount)} />;
  }
  if (inCartCount > 0 && !selected) {
    return <StatusChip tone="success" label={i18n.plural("tickets.inCart", inCartCount)} />;
  }
  return (
    <View style={local.cta}>
      <AppText variant="label" tone="brand" numberOfLines={1}>
        {selected ? i18n.t("tickets.chooseSeats") : i18n.t("tickets.viewSeats")}
      </AppText>
      <DirectionalChevron kind="forward" size={14} color={theme.colors.tones.brand.fg} />
    </View>
  );
}

function StatusChip({ tone, label }: { tone: "brand" | "success"; label: string }) {
  const theme = useTheme();
  const colors = theme.colors.tones[tone];
  return (
    <View style={[local.chip, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <AppText variant="caption" style={{ color: colors.fg, fontWeight: "700" }} numberOfLines={1}>{label}</AppText>
    </View>
  );
}

const local = {
  card: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, overflow: "hidden" as const },
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  stripe: { width: 4, alignSelf: "stretch" as const, borderRadius: radius.xs },
  details: { flex: 1, minWidth: 0, gap: spacing.xs },
  detailsPress: { flex: 1, minWidth: 0, minHeight: size.touchTargetMin, justifyContent: "center" as const },
  metaRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: spacing.sm },
  kindPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  priceRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "baseline" as const, gap: spacing.xs },
  // Never squeezed by a long zone name: the details column absorbs the width instead.
  end: { flexShrink: 0, alignItems: "flex-end" as const },
  pressed: { opacity: 0.85 },
  stepper: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  stepperButton: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  stepperValue: { minWidth: 32 },
  cta: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs, minHeight: size.touchTargetMin },
  chip: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
};
