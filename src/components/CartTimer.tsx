import { StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { View } from "react-native";
import { minutesSeconds } from "@/lib/format";
import { useTheme } from "@/components/ui";

/**
 * Renders "MM:SS" without clipping the trailing digit.
 *
 * Root cause of the historical bug: every previous call site rendered the
 * timer as a bare <Text> with no reserved width inside a flex row (or, for
 * the header badge, inside a pill sized only by `minWidth` + `paddingHorizontal`
 * whose `borderRadius` ate into the last character's box). Once the text
 * reflowed (a re-render every second) or the pill's rounded corners clipped
 * the rightmost glyph, the final digit disappeared (e.g. "09:2" instead of
 * "09:25"). Fixing this requires reserving fixed layout space for the widest
 * possible value ("88:88"), not just relying on intrinsic text width.
 */
export function CartTimer({
  seconds,
  style,
  variant = "text",
}: {
  seconds: number;
  style?: StyleProp<TextStyle>;
  /** Bare timer text used internally by the shared pill and legacy inline contexts. */
  variant?: "text";
}) {
  return (
    <Text
      numberOfLines={1}
      allowFontScaling
      maxFontSizeMultiplier={1.6}
      style={[styles.text, style]}
    >
      {minutesSeconds(Math.max(0, seconds))}
    </Text>
  );
}

/**
 * Self-contained pill badge variant, for overlaying on the header cart icon.
 * Sized generously enough (fixed minWidth + padding that clears the rounded
 * corners) that "88:88" always fits without being clipped by the pill shape.
 */
/** Shared purchase-flow countdown treatment. The value always comes from CartContext. */
export function CartTimerPill({ seconds, style }: { seconds: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: theme.colors.primary }, style]} accessibilityLabel={`${minutesSeconds(Math.max(0, seconds))} remaining`}>
      <CartTimer seconds={seconds} style={styles.pillText} />
    </View>
  );
}

const styles = StyleSheet.create({
  text: {
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.3,
    minWidth: 54,
    textAlign: "center",
    flexShrink: 0,
  },
  pill: {
    width: 76,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pillText: {
    minWidth: 62,
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "800",
  },
});
