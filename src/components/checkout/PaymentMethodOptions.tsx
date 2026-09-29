import { AppText } from "@/components/foundation";
import { PaymentMethodIcon, type PaymentMethodOption } from "@/components/PaymentMethodSheet";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, size, spacing } from "@/lib/designTokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

/** Only the methods the backend supports. No other method may be added here. */
const METHODS: { id: PaymentMethodOption; titleKey: "checkout.payment.card.title" | "checkout.payment.blue.title"; detailKey: "checkout.payment.card.detail" | "checkout.payment.blue.detail" }[] = [
  { id: "cybersource", titleKey: "checkout.payment.card.title", detailKey: "checkout.payment.card.detail" },
  { id: "blue", titleKey: "checkout.payment.blue.title", detailKey: "checkout.payment.blue.detail" },
];

/**
 * Inline payment-method radio group. Presentation only: Checkout owns the
 * selection (and everything a selection triggers, e.g. preparing the card
 * form). `status` renders an owner-provided line under a method (card setup
 * progress or error).
 */
export function PaymentMethodOptions({
  selected,
  disabled,
  onSelect,
  status,
}: {
  selected: PaymentMethodOption | null;
  disabled: boolean;
  onSelect: (method: PaymentMethodOption) => void;
  status?: Partial<Record<PaymentMethodOption, ReactNode>>;
}) {
  const theme = useTheme();
  const i18n = useI18n();

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={i18n.t("checkout.payment.title")} style={local.group}>
      {METHODS.map((method) => {
        const active = selected === method.id;
        const title = i18n.t(method.titleKey);
        const detail = i18n.t(method.detailKey);
        return (
          <View key={method.id} style={local.item}>
            <Pressable
              onPress={() => onSelect(method.id)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={title}
              accessibilityHint={detail}
              accessibilityState={{ checked: active, disabled }}
              aria-checked={active}
              aria-disabled={disabled}
              style={({ pressed }) => [
                local.option,
                {
                  backgroundColor: active ? theme.colors.selectedSurface : theme.colors.surface,
                  borderColor: active ? theme.colors.tones.brand.fg : theme.colors.border,
                  borderWidth: active ? 2 : 1,
                },
                pressed && !disabled && local.pressed,
                disabled && local.dimmed,
              ]}
            >
              <View style={[local.icon, { backgroundColor: theme.colors.scanSurface, borderColor: theme.colors.border }]}>
                <PaymentMethodIcon method={method.id} size={22} />
              </View>
              <View style={local.copy}>
                <AppText variant="cardTitle">{title}</AppText>
                <AppText variant="meta" tone="muted">{detail}</AppText>
              </View>
              {/* Radio mark: filled ring when selected, shape not colour alone. */}
              <View
                style={[local.radio, { borderColor: active ? theme.colors.tones.brand.fg : theme.colors.textMuted }]}
              >
                {active ? <View style={[local.radioDot, { backgroundColor: theme.colors.tones.brand.fg }]} /> : null}
              </View>
            </Pressable>
            {active && status?.[method.id] ? <View style={local.status}>{status[method.id]}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

const local = {
  group: { gap: spacing.sm },
  item: { gap: spacing.sm },
  option: {
    minHeight: size.touchTarget + spacing.lg,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
  },
  pressed: { opacity: 0.85 },
  dimmed: { opacity: 0.55 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  status: { paddingStart: spacing.md },
};
