import { AppText } from "@/components/foundation/AppText";
import { DirectionalChevron } from "@/components/foundation/direction";
import { useTheme } from "@/components/ui";
import { size, spacing } from "@/lib/designTokens";
import { Pressable, View } from "react-native";

type Props = {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void; accessibilityHint?: string };
};

/** Section title with optional supporting text and one trailing text action. */
export function SectionHeader({ title, subtitle, action }: Props) {
  const theme = useTheme();
  return (
    <View style={local.row}>
      <View style={local.copy}>
        <AppText variant="sectionTitle" accessibilityRole="header">{title}</AppText>
        {subtitle ? <AppText variant="meta" tone="muted">{subtitle}</AppText> : null}
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.accessibilityHint}
          hitSlop={8}
          style={({ pressed }) => [local.action, pressed && { opacity: 0.7 }]}
        >
          <AppText variant="label" tone="brand">{action.label}</AppText>
          <DirectionalChevron kind="forward" size={14} color={theme.colors.tones.brand.fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

const local = {
  row: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  action: {
    minHeight: size.touchTargetMin,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    flexShrink: 0,
  },
};
