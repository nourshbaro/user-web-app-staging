import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { radius, size, spacing, typography } from "@/lib/designTokens";
import { fontStyleFor } from "@/lib/fontFamilies";
import type { StatusTone } from "@/lib/themePalette";
import { Text, View } from "react-native";

type Props = {
  /** Already-localized label supplied by the screen that owns the status. */
  label: string;
  tone?: StatusTone;
  /** Visual prefix dot, e.g. for "live". Decorative only. */
  showDot?: boolean;
};

/**
 * Presentation-only status pill. The caller decides which backend status maps
 * to which tone; this component never interprets statuses itself.
 */
export function StatusBadge({ label, tone = "neutral", showDot = false }: Props) {
  const theme = useTheme();
  const { meta } = useI18n();
  const colors = theme.colors.tones[tone];
  return (
    <View
      style={[local.pill, { backgroundColor: colors.bg, borderColor: colors.border }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {showDot ? <View style={[local.dot, { backgroundColor: colors.fg }]} /> : null}
      <Text
        numberOfLines={1}
        style={[
          local.text,
          fontStyleFor("text", "700", meta.script),
          { color: colors.fg },
          // Uppercase has no meaning in Arabic script; keep natural case there.
          meta.script === "latin" && local.uppercase,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const local = {
  pill: {
    alignSelf: "flex-start" as const,
    minHeight: size.badgeHeight,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight },
  uppercase: { textTransform: "uppercase" as const },
};
