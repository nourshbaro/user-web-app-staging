import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { size, spacing } from "@/lib/designTokens";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

/*
 * Presentation-only ticket option pieces for Match Details. They render
 * values and call back into the screen; they never read the cart, fetch, or
 * hold selection state. The screen (and, for committed state, CartContext)
 * owns everything they show.
 */

/** v3 grouped zone list: one card, hairline rows, radio semantics. */
export function ZoneList({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[local.list, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}
    >
      {children}
    </View>
  );
}

type ZoneRowProps = {
  name: string;
  /** "Reserved seating" / "General admission", plus any in-cart or draft note. */
  detail: string;
  priceLabel: string;
  selected: boolean;
  first: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
};

/**
 * One zone in the v3 "Choose where to sit" list. The whole row is a single
 * radio; it holds no nested controls (the GA quantity stepper lives in the
 * screen's action bar for the selected zone).
 */
export function ZoneRow({ name, detail, priceLabel, selected, first, onPress, accessibilityLabel, accessibilityHint }: ZoneRowProps) {
  const theme = useTheme();
  const brand = theme.colors.tones.brand;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      style={({ pressed }) => [
        local.row,
        !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline },
        { backgroundColor: selected ? brand.bg : "transparent" },
        pressed && !selected && { backgroundColor: theme.colors.surfaceSecondary },
      ]}
    >
      <RadioMark selected={selected} />
      <View style={local.copy}>
        <AppText variant="bodyStrong" numberOfLines={2}>{name}</AppText>
        <AppText variant="meta" tone="muted" numberOfLines={2} style={local.detail}>{detail}</AppText>
      </View>
      <AppText variant="bodyStrong" style={local.price}>{priceLabel}</AppText>
    </Pressable>
  );
}

/** 22pt radio ring with a 10pt dot: shape, not colour alone, marks selection. */
export function RadioMark({ selected }: { selected: boolean }) {
  const theme = useTheme();
  const ring = selected ? theme.colors.actionPrimary : theme.colors.textMuted;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[local.radio, { borderColor: ring }]}
    >
      {selected ? <View style={[local.radioDot, { backgroundColor: theme.colors.actionPrimary }]} /> : null}
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

  const glyph = (name: { ios: string; android: string; web: string }, inactive: boolean) => (
    <SymbolView
      name={name as never}
      size={size.iconMd}
      tintColor={inactive ? theme.colors.disabledText : theme.colors.textStrong}
      fallback={<AppText variant="action" style={{ color: inactive ? theme.colors.disabledText : theme.colors.textStrong }}>{name.web === "add" ? "+" : "−"}</AppText>}
    />
  );

  return (
    <View style={[local.stepper, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
      <Pressable
        onPress={onDecrement}
        disabled={minusDisabled}
        accessibilityRole="button"
        accessibilityLabel={i18n.t("tickets.stepper.decrease", { zone: zoneName })}
        accessibilityState={{ disabled: minusDisabled }}
        aria-disabled={minusDisabled}
        style={({ pressed }) => [local.stepperButton, pressed && !minusDisabled && local.pressed]}
      >
        {glyph({ ios: "minus", android: "remove", web: "remove" }, minusDisabled)}
      </Pressable>
      <View style={local.stepperValue}>
        <AppText
          variant="bodyStrong"
          align="center"
          style={local.quantity}
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
        style={({ pressed }) => [local.stepperButton, pressed && !disabled && local.pressed]}
      >
        {glyph({ ios: "plus", android: "add", web: "add" }, disabled)}
      </Pressable>
    </View>
  );
}

const local = {
  // v3 zone list: one card, radius 20.
  list: { borderRadius: 20, overflow: "hidden" as const },
  row: {
    minHeight: 64,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  detail: { fontWeight: "400" as const },
  // Never squeezed by a long zone name: the name column absorbs the width instead.
  price: { flexShrink: 0, fontVariant: ["tabular-nums" as const] },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  pressed: { opacity: 0.6 },
  // v3 stepper: radius 12, card surface with shadow; buttons grown to the 44pt target.
  stepper: { flexDirection: "row" as const, alignItems: "center" as const, borderRadius: 12 },
  stepperButton: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  stepperValue: { minWidth: 28 },
  quantity: { fontSize: 17, fontVariant: ["tabular-nums" as const] },
};
