import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { radius, spacing } from "@/lib/designTokens";
import type { PropsWithChildren } from "react";
import { View } from "react-native";

/**
 * Grouped card holding match rows (v3: radius 20, `--shadow`, no border),
 * with an optional heading above it (e.g. the date the fixtures share).
 * Layout only.
 */
export function MatchGroup({ heading, children }: PropsWithChildren<{ heading?: string }>) {
  const theme = useTheme();
  return (
    <View>
      {heading ? (
        <AppText variant="overline" tone="muted" accessibilityRole="header" style={local.heading}>{heading}</AppText>
      ) : null}
      <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
        {children}
      </View>
    </View>
  );
}

const local = {
  // v3: padding 18 20 8 (the list already applies the 16pt gutter).
  heading: { paddingTop: 18, paddingBottom: spacing.sm, paddingHorizontal: spacing.xs },
  card: { borderRadius: radius.xl, overflow: "hidden" as const },
};
