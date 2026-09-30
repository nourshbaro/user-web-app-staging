import { AppText, DirectionalChevron } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { size, spacing } from "@/lib/designTokens";
import { Pressable, View } from "react-native";

/**
 * v3 transactional-flow header (seats, cart, holders, checkout): a 48pt bar
 * with a back action and a centred title. Presentation only — the screen
 * owns what Back does (and whether it is currently allowed).
 */
export function FlowHeader({
  title,
  subtitle,
  backLabel,
  onBack,
  backDisabled = false,
}: {
  title: string;
  subtitle?: string;
  /** Short name of the previous step shown beside the chevron (v3 "Match", "Cart", "Holders"). */
  backLabel?: string;
  onBack: () => void;
  backDisabled?: boolean;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  return (
    <View style={local.header}>
      <Pressable
        onPress={() => {
          if (!backDisabled) onBack();
        }}
        disabled={backDisabled}
        accessibilityRole="button"
        accessibilityLabel={backLabel ? i18n.t("flow.backTo", { step: backLabel }) : i18n.t("common.back")}
        aria-disabled={backDisabled}
        hitSlop={4}
        style={({ pressed }) => [local.back, (pressed || backDisabled) && { opacity: backDisabled ? 0.4 : 0.6 }]}
      >
        <DirectionalChevron kind="back" size={20} color={theme.colors.brandInk} />
        {backLabel ? (
          <AppText variant="bodyStrong" numberOfLines={1} style={{ color: theme.colors.brandInk, fontWeight: "400", fontSize: 17 }}>
            {backLabel}
          </AppText>
        ) : null}
      </Pressable>
      <View style={local.center} pointerEvents="none">
        <AppText variant="bodyStrong" align="center" numberOfLines={1} accessibilityRole="header" style={local.title}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="muted" align="center" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={local.end} />
    </View>
  );
}

/** v3 two-step progress (Holders → Payment): 4pt segments, done steps in brand red. */
export function StepBar({ step, total = 2 }: { step: number; total?: number }) {
  const theme = useTheme();
  const i18n = useI18n();
  return (
    <View
      style={local.steps}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={i18n.t("flow.step", { step, total })}
      accessibilityValue={{ min: 1, max: total, now: step }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[local.segment, { backgroundColor: index < step ? theme.colors.actionPrimary : theme.colors.bgAlt }]}
        />
      ))}
    </View>
  );
}

const local = {
  header: {
    minHeight: size.touchTarget,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.sm,
  },
  back: {
    minHeight: size.touchTargetMin,
    minWidth: size.touchTargetMin,
    maxWidth: "30%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2,
    zIndex: 1,
  },
  center: { position: "absolute" as const, left: 96, right: 96, alignItems: "center" as const },
  title: { fontSize: 17, lineHeight: 22 },
  end: { flex: 1 },
  steps: { flexDirection: "row" as const, gap: 6 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
};
