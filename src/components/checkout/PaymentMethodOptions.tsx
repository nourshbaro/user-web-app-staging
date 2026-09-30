import { AppText } from "@/components/foundation";
import { RadioMark } from "@/components/match/TicketOptions";
import { PaymentMethodIcon, type PaymentMethodOption } from "@/components/PaymentMethodSheet";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { size, spacing } from "@/lib/designTokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

/** Only the methods the backend supports. No other method may be added here. */
const METHODS: { id: PaymentMethodOption; titleKey: "checkout.payment.card.title" | "checkout.payment.blue.title"; detailKey: "checkout.payment.card.detail" | "checkout.payment.blue.detail" }[] = [
  { id: "cybersource", titleKey: "checkout.payment.card.title", detailKey: "checkout.payment.card.detail" },
  { id: "blue", titleKey: "checkout.payment.blue.title", detailKey: "checkout.payment.blue.detail" },
];

/**
 * v3 "Pay with" radio cards. Presentation only: Checkout owns the selection
 * (and everything a selection triggers, e.g. preparing the card form).
 * Selecting a method never starts a payment — only Checkout's explicit
 * action does. `status` renders an owner-provided line under a method (card
 * setup progress or error); no card fields are ever drawn here, the real
 * card form is CyberSource's own.
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
          <View
            key={method.id}
            style={[
              local.card,
              {
                backgroundColor: theme.colors.surface,
                boxShadow: active
                  ? `inset 0px 0px 0px 2px ${theme.colors.actionPrimary}, ${theme.colors.shadowCard}`
                  : theme.colors.shadowCard,
              },
            ]}
          >
            <Pressable
              onPress={() => onSelect(method.id)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={title}
              accessibilityHint={detail}
              accessibilityState={{ checked: active, disabled }}
              aria-checked={active}
              aria-disabled={disabled}
              style={({ pressed }) => [local.option, pressed && !disabled && local.pressed, disabled && local.dimmed]}
            >
              <View style={[local.icon, { backgroundColor: theme.colors.bgAlt }]}>
                <PaymentMethodIcon method={method.id} size={22} />
              </View>
              <View style={local.copy}>
                <AppText variant="bodyStrong" style={local.title}>{title}</AppText>
                <AppText variant="meta" tone="muted" style={local.detail}>{detail}</AppText>
              </View>
              <RadioMark selected={active} />
            </Pressable>
            {active && status?.[method.id] ? <View style={local.status}>{status[method.id]}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

const local = {
  group: { gap: 10 },
  // v3: radius 20 card; the selected one gets an inset 2pt brand ring.
  card: { borderRadius: 20 },
  option: {
    minHeight: size.touchTarget + spacing.xl,
    padding: spacing.lg,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
  },
  pressed: { opacity: 0.7 },
  dimmed: { opacity: 0.55 },
  // v3: 40pt tile, radius 11, --bg2.
  icon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 16, lineHeight: 21 },
  detail: { fontWeight: "400" as const },
  status: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
};
