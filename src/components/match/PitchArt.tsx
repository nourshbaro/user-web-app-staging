import { useTheme } from "@/components/ui";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Pattern, RadialGradient, Rect, Stop } from "react-native-svg";

/**
 * Decorative match-day texture for dark hero surfaces: faint diagonal stripes
 * and a soft brand-red glow from the top corner. Artwork only — it carries no
 * data, is hidden from assistive tech, and never intercepts touches.
 */
export function PitchArt() {
  const theme = useTheme();
  // Unique ids: several heroes can be mounted at once (e.g. across a navigation stack).
  const id = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const stripe = `pitchStripe${id}`;
  const glow = `pitchGlow${id}`;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={StyleSheet.absoluteFill}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        {/* Paint servers are registered by id; they render nothing themselves. */}
        <Pattern id={stripe} width={16} height={16} patternUnits="userSpaceOnUse" patternTransform="rotate(-32)">
          <Rect width={7} height={16} fill={theme.colors.onHero} opacity={0.04} />
        </Pattern>
        <RadialGradient id={glow} cx="92%" cy="-6%" r="80%">
          <Stop offset="0%" stopColor={theme.colors.actionPrimary} stopOpacity={0.55} />
          <Stop offset="50%" stopColor={theme.colors.actionPrimary} stopOpacity={0.1} />
          <Stop offset="100%" stopColor={theme.colors.actionPrimary} stopOpacity={0} />
        </RadialGradient>
        <Rect width="100%" height="100%" fill={`url(#${stripe})`} />
        <Rect width="100%" height="100%" fill={`url(#${glow})`} />
      </Svg>
    </View>
  );
}
