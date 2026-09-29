import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { radius, spacing } from "@/lib/designTokens";
import type { PropsWithChildren } from "react";
import { View } from "react-native";

/**
 * Grouped card holding match rows (v3), with an optional heading above it
 * (e.g. the date the fixtures share). Layout only.
 */
export function MatchGroup({ heading, children }: PropsWithChildren<{ heading?: string }>) {
  const theme = useTheme();
  return (
    <View style={local.section}>
      {heading ? (
        <AppText variant="overline" tone="muted" accessibilityRole="header" style={local.heading}>{heading}</AppText>
      ) : null}
      <View
        style={[
          local.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.hairline, boxShadow: `0 6px 20px ${theme.colors.shadow}` },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const local = {
  section: { gap: spacing.sm },
  heading: { paddingHorizontal: spacing.xs },
  card: { borderRadius: radius.xl, borderWidth: 1, overflow: "hidden" as const },
};
