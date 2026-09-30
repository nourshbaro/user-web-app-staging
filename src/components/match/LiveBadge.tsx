import { useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { fontStyleFor } from "@/lib/fontFamilies";
import { useEffect, useState } from "react";
import { Animated, Text, View } from "react-native";

/**
 * v3 live indicator: a red dot that blinks (static under reduced motion).
 * Shown only for a backend `live` status; it never carries a minute, which
 * the API does not provide.
 */
export function LiveDot({ size = 6 }: { size?: number }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [blink] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reducedMotion) {
      blink.setValue(1);
      return;
    }
    // v3 `lfBlink 1.4s`: opacity 1 → .25 → 1.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink, reducedMotion]);

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.actionPrimary, opacity: blink }}
    />
  );
}

/** v3 row badge for a live match: dot + label on the soft brand surface. */
export function LiveBadge({ label }: { label: string }) {
  const theme = useTheme();
  const { meta } = useI18n();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[local.badge, { backgroundColor: theme.colors.selectedSurface }]}
    >
      <LiveDot />
      <Text
        numberOfLines={1}
        style={[local.text, fontStyleFor("text", "600", meta.script), { color: theme.colors.brandInk }, meta.script === "latin" && local.upper]}
      >
        {label}
      </Text>
    </View>
  );
}

const local = {
  badge: { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  text: { fontSize: 11, lineHeight: 15 },
  upper: { textTransform: "uppercase" as const },
};
