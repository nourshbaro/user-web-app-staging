import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Animated, Easing, Image, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { RadialGradient, Rect, Stop } from "react-native-svg";

/** v3 easing `cubic-bezier(.22,1,.36,1)`. */
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const FADE_OUT_MS = 220;

/** v3 radial red: `radial-gradient(120% 80% at 50% 40%, glow 0%, surface 70%, deep 100%)`. */
export function BrandBackdrop() {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <RadialGradient id="lfaSplash" cx="50%" cy="40%" rx="120%" ry="80%" fx="50%" fy="40%">
          <Stop offset="0" stopColor={theme.colors.brandGlow} />
          <Stop offset="0.7" stopColor={theme.colors.brandSurface} />
          <Stop offset="1" stopColor={theme.colors.brandDeep} />
        </RadialGradient>
        <Rect width="100%" height="100%" fill="url(#lfaSplash)" />
      </Svg>
    </View>
  );
}

/**
 * v3 launch splash, shown on every launch while startup resolves (see
 * `src/lib/launchSplash.ts`). Presentation only: no navigation, no storage,
 * no touch handling — whatever the launch resolves to sits beneath it and is
 * revealed unchanged. `leaving` fades it out (instantly under reduced motion),
 * then `onHidden` unmounts it.
 */
export function LaunchSplash({ leaving, onHidden }: { leaving: boolean; onHidden: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [logo] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [word] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [presence] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reducedMotion) {
      logo.setValue(1);
      word.setValue(1);
      return;
    }
    // v3 `lfLogo .7s` then `lfWord .6s .25s`.
    Animated.parallel([
      Animated.timing(logo, { toValue: 1, duration: 700, easing: EASE_OUT, useNativeDriver: true }),
      Animated.timing(word, { toValue: 1, duration: 600, delay: 250, easing: EASE_OUT, useNativeDriver: true }),
    ]).start();
  }, [logo, reducedMotion, word]);

  useEffect(() => {
    if (!leaving) return;
    if (reducedMotion) {
      onHidden();
      return;
    }
    Animated.timing(presence, { toValue: 0, duration: FADE_OUT_MS, easing: EASE_OUT, useNativeDriver: true }).start(() => onHidden());
  }, [leaving, onHidden, presence, reducedMotion]);

  const rise = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, local.root, { opacity: presence }]}
      // Blocks touches to the app beneath only until it starts to leave.
      pointerEvents={leaving ? "none" : "auto"}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("onboarding.splash.a11y")}
      aria-busy
    >
      <StatusBar style="light" />
      <BrandBackdrop />
      <View style={local.center}>
        <Animated.View
          style={[
            local.logo,
            { backgroundColor: theme.colors.scanSurface },
            { opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] },
          ]}
        >
          <Image source={require("../../../assets/images/lfa-logo.png")} style={local.logoImage} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[local.copy, rise(word)]}>
          <AppText variant="displayHero" align="center" style={{ color: theme.colors.onBrandSurface }}>{t("onboarding.splash.title")}</AppText>
          <AppText variant="bodyStrong" align="center" style={[local.subtitle, { color: theme.colors.onBrandSurface }]}>{t("onboarding.splash.subtitle")}</AppText>
        </Animated.View>
      </View>
      <Animated.View style={[local.footer, { bottom: insets.bottom + 44 }, rise(word)]}>
        <AppText variant="overline" align="center" style={[local.footerText, { color: theme.colors.onBrandSurface }]}>{t("onboarding.splash.footer")}</AppText>
      </Animated.View>
    </Animated.View>
  );
}

const local = {
  root: { zIndex: 20, alignItems: "center" as const, justifyContent: "center" as const },
  center: { alignItems: "center" as const, gap: 22 },
  // v3: 132pt white disc, 118pt mark, shadow 0 20 50 rgba(60,0,10,.35).
  logo: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    boxShadow: "0px 20px 50px rgba(60,0,10,0.35)",
  },
  logoImage: { width: 118, height: 118 },
  copy: { alignItems: "center" as const, gap: 6 },
  subtitle: { fontSize: 14, lineHeight: 19, opacity: 0.78 },
  footer: { position: "absolute" as const, left: 0, right: 0 },
  footerText: { opacity: 0.7 },
};
