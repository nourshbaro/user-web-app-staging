import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { radius, spacing } from "@/lib/designTokens";
import { useEffect, useState, type PropsWithChildren } from "react";
import { Animated, View, type DimensionValue } from "react-native";

/**
 * Low-motion placeholder shapes. Shown only while the owning screen's real
 * request is pending — never used to add artificial delay. With reduced
 * motion enabled the placeholders are static.
 */
export function SkeletonBlock({
  width = "100%",
  height = 16,
  borderRadius = radius.sm,
}: {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: theme.colors.skeleton,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
      }}
    />
  );
}

/** Paragraph placeholder; the last line is shorter. */
export function SkeletonText({ lines = 2 }: { lines?: number }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonBlock key={index} height={12} width={index === lines - 1 && lines > 1 ? "60%" : "100%"} />
      ))}
    </View>
  );
}

/**
 * Groups placeholders into one accessible "loading" element so screen readers
 * hear a single status instead of many empty shapes.
 */
export function SkeletonGroup({ children, label }: PropsWithChildren<{ label?: string }>) {
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t("common.loading")}
      aria-busy
      style={{ gap: spacing.md }}
    >
      {children}
    </View>
  );
}
