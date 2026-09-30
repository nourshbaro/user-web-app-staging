import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { countdownParts, reservationUrgency } from "@/lib/cartPresentation";
import { motion, radius, size, spacing } from "@/lib/designTokens";
import { minutesSeconds } from "@/lib/format";
import { useEffect, useState } from "react";
import { Animated, Pressable, View } from "react-native";

/** Visible strip height below the status bar (the press target is the full strip). */
export const RESERVATION_HOLD_BAR_HEIGHT = size.touchTarget;

type Props = {
  /** `CartContext.secondsLeft` — the owner's value, derived from the backend `expires_at`. */
  secondsLeft: number;
  /** Status-bar inset the strip paints behind (the screens below no longer do). */
  topInset: number;
  onPress: () => void;
};

/**
 * Global "Reservation held · mm:ss · View" indicator. Presentation only: it
 * shows the cart owner's countdown and opens the existing cart. It never
 * computes expiry, extends, clears or re-creates a reservation (expiry itself
 * is handled by `CartContext` and explained by `ReservationExpiryNotice`).
 *
 * It sits in the layout flow above the screen (never over it), so it cannot
 * cover navigation, content or transaction actions. It announces nothing per
 * second: screen readers read the current value when focused.
 */
export function ReservationHoldBar({ secondsLeft, topInset, onPress }: Props) {
  const theme = useTheme();
  const i18n = useI18n();
  // v3: the countdown turns pink in the final minute.
  const urgent = reservationUrgency(secondsLeft) === "critical";
  const { minutes, seconds } = countdownParts(secondsLeft);

  return (
    <View style={[local.strip, { paddingTop: topInset, backgroundColor: theme.colors.background }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={i18n.t("reservation.indicator.a11y", { minutes, seconds })}
        accessibilityHint={i18n.t("reservation.indicator.hint")}
        style={local.target}
      >
        {({ pressed }) => (
          <View
            style={[
              local.pill,
              {
                backgroundColor: theme.colors.hero,
                borderColor: theme.colors.heroHairline,
                opacity: pressed ? 0.86 : 1,
              },
            ]}
          >
            <PulseDot color={theme.isDark ? theme.colors.primaryLight : theme.colors.primaryDark} />
            <AppText variant="meta" tone="onHero" numberOfLines={1} style={local.label}>
              {i18n.t("reservation.indicator.label")}
            </AppText>
            <AppText
              variant="displayCountdown"
              numberOfLines={1}
              style={[local.time, { color: urgent ? theme.colors.onHeroUrgent : theme.colors.onHero }]}
            >
              {minutesSeconds(secondsLeft)}
            </AppText>
            <View style={local.view}>
              <AppText variant="caption" tone="onHero">{i18n.t("reservation.indicator.view")}</AppText>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** Soft "live hold" pulse; static under reduced motion. Decorative only. */
function PulseDot({ color }: { color: string }) {
  const reducedMotion = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: motion.sheet * 6, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  return (
    <View style={local.dotWrap} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          local.dot,
          {
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
          },
        ]}
      />
      <View style={[local.dot, { backgroundColor: color }]} />
    </View>
  );
}

const local = {
  strip: { width: "100%" as const, alignItems: "center" as const },
  target: {
    minHeight: RESERVATION_HOLD_BAR_HEIGHT,
    maxWidth: "100%" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingHorizontal: spacing.lg,
  },
  // v3: 30pt night pill, radius 15, padding 0 5 0 12, gap 9.
  pill: {
    minHeight: 30,
    maxWidth: "100%" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 9,
    paddingStart: spacing.md,
    paddingEnd: 5,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: { flexShrink: 1, fontSize: 13, lineHeight: 17 },
  // Reserve the widest value so the pill never reflows every second.
  time: { minWidth: 44, textAlign: "center" as const },
  // v3: 22pt chip, radius 11, rgba(255,255,255,.14), 12/600.
  view: { minHeight: 22, justifyContent: "center" as const, borderRadius: 11, paddingHorizontal: 9, backgroundColor: "rgba(255,255,255,0.14)" },
  dotWrap: { width: 8, height: 8 },
  dot: { position: "absolute" as const, width: 8, height: 8, borderRadius: 4 },
};
