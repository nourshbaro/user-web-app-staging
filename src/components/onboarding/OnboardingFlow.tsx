import { AppText } from "@/components/foundation";
import { PitchArt } from "@/components/match/PitchArt";
import { Button, useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";
import { layout, radius, spacing } from "@/lib/designTokens";
import { INTRO_PAGE_COUNT, type OnboardingStep } from "@/lib/onboarding";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, BackHandler, Easing, Image, Pressable, ScrollView, useWindowDimensions, View, type Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { RadialGradient, Rect, Stop } from "react-native-svg";

/** The splash advances on its own after this long (or on a tap), unless a screen reader is running. */
const SPLASH_HOLD_MS = 1400;
/** v3 easing `cubic-bezier(.22,1,.36,1)`. */
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

const INTRO_PAGES: { icon: { ios: string; android: string; web: string }; title: MessageKey; body: MessageKey }[] = [
  { icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" }, title: "onboarding.intro.matches.title", body: "onboarding.intro.matches.body" },
  { icon: { ios: "sportscourt", android: "stadium", web: "stadium" }, title: "onboarding.intro.seats.title", body: "onboarding.intro.seats.body" },
  { icon: { ios: "ticket", android: "confirmation_number", web: "confirmation_number" }, title: "onboarding.intro.tickets.title", body: "onboarding.intro.tickets.body" },
];

type Props = {
  /** Show the notification pre-prompt (the OS can still ask and push exists). */
  offerNotifications: boolean;
  /**
   * The explicit "Turn on notifications" action. The only place onboarding
   * reaches the native permission prompt; the owner decides what that means.
   */
  onTurnOnNotifications: () => Promise<unknown>;
  /** Onboarding is finished (flag written by the owner). */
  onFinish: () => void;
};

/**
 * First-run flow (LFA Screen v3): splash → three product pages → notification
 * pre-prompt. Presentation only: no navigation, no data, and no permission
 * request except through `onTurnOnNotifications` after the user taps "Turn on
 * notifications".
 */
export function OnboardingFlow({ offerNotifications, onTurnOnNotifications, onFinish }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<OnboardingStep>("splash");
  const [page, setPage] = useState(0);
  const [requesting, setRequesting] = useState(false);

  const finishIntro = useCallback(() => {
    if (offerNotifications) setStep("notifications");
    else onFinish();
  }, [offerNotifications, onFinish]);

  // Stable, so the splash's auto-advance timer is not restarted by parent renders.
  const showIntro = useCallback(() => setStep("intro"), []);

  const next = useCallback(() => {
    if (page < INTRO_PAGE_COUNT - 1) setPage(page + 1);
    else finishIntro();
  }, [finishIntro, page]);

  // Android back steps backwards through onboarding; at the start it keeps the default behaviour.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (requesting) return true;
      if (step === "notifications") {
        setStep("intro");
        setPage(INTRO_PAGE_COUNT - 1);
        return true;
      }
      if (step === "intro" && page > 0) {
        setPage(page - 1);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [page, requesting, step]);

  const turnOn = async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      await onTurnOnNotifications();
    } catch (error) {
      // Push is optional: a failed prompt or registration never blocks the app.
      console.warn("Notification opt-in failed:", error);
    } finally {
      setRequesting(false);
      onFinish();
    }
  };

  return (
    <View
      style={[local.root, { backgroundColor: step === "splash" ? theme.colors.brandSurface : theme.colors.background }]}
      accessibilityViewIsModal
    >
      <StatusBar style={step === "notifications" ? (theme.isDark ? "light" : "dark") : "light"} />
      {step === "splash" ? (
        <SplashStep bottomInset={insets.bottom} onContinue={showIntro} />
      ) : step === "intro" ? (
        <IntroStep page={page} bottomInset={insets.bottom} onSkip={finishIntro} onNext={next} />
      ) : (
        <NotificationStep
          topInset={insets.top}
          bottomInset={insets.bottom}
          requesting={requesting}
          onTurnOn={turnOn}
          onNotNow={onFinish}
        />
      )}
    </View>
  );
}

/** v3 radial red: `radial-gradient(120% 80% at 50% 40%, glow 0%, surface 70%, deep 100%)`. */
function BrandBackdrop() {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={local.fill} accessible={false} importantForAccessibility="no-hide-descendants">
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

function SplashStep({ bottomInset, onContinue }: { bottomInset: number; onContinue: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [logo] = useState(() => new Animated.Value(0));
  const [word] = useState(() => new Animated.Value(0));

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

  // Auto-advance for sighted users; a screen reader user moves on with the button.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void AccessibilityInfo.isScreenReaderEnabled()
      .catch(() => false)
      .then((screenReader) => {
        if (cancelled || screenReader) return;
        timer = setTimeout(onContinue, SPLASH_HOLD_MS);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [onContinue]);

  const rise = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  });

  return (
    <Pressable onPress={onContinue} accessibilityRole="button" accessibilityLabel={t("onboarding.splash.a11y")} style={local.splash}>
      <BrandBackdrop />
      <View style={local.splashCenter}>
        <Animated.View
          style={[
            local.splashLogo,
            { backgroundColor: theme.colors.scanSurface },
            { opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] },
          ]}
        >
          <Image source={require("../../../assets/images/lfa-logo.png")} style={local.splashLogoImage} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[local.splashCopy, rise(word)]}>
          <AppText variant="displayHero" align="center" style={{ color: theme.colors.onBrandSurface }}>{t("onboarding.splash.title")}</AppText>
          <AppText variant="bodyStrong" align="center" style={[local.splashSubtitle, { color: theme.colors.onBrandSurface }]}>{t("onboarding.splash.subtitle")}</AppText>
        </Animated.View>
      </View>
      <Animated.View style={[local.splashFooter, { bottom: bottomInset + 44 }, rise(word)]}>
        <AppText variant="overline" align="center" style={[local.splashFooterText, { color: theme.colors.onBrandSurface }]}>{t("onboarding.splash.footer")}</AppText>
      </Animated.View>
    </Pressable>
  );
}

function IntroStep({
  page,
  bottomInset,
  onSkip,
  onNext,
}: {
  page: number;
  bottomInset: number;
  onSkip: () => void;
  onNext: () => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const content = INTRO_PAGES[page];
  const titleRef = useRef<Text>(null);
  const [enter] = useState(() => new Animated.Value(1));
  const last = page === INTRO_PAGE_COUNT - 1;
  // v3: a 470pt art panel on an 844pt screen; scaled for other heights.
  const artHeight = Math.round(Math.min(470, height * 0.56));

  // Each page change moves the screen reader to the new title, and (v3 `lfPush`) slides the copy in.
  useEffect(() => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
    if (reducedMotion) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 400, easing: EASE_OUT, useNativeDriver: true }).start();
  }, [enter, page, reducedMotion]);

  return (
    <View style={local.fill}>
      <View style={[local.art, { height: artHeight, backgroundColor: theme.colors.hero }]}>
        <PitchArt />
        <View style={[local.artBadge, { backgroundColor: theme.colors.heroRaised, borderColor: theme.colors.heroHairline }]}>
          <SymbolView name={content.icon as never} size={48} tintColor={theme.colors.onHero} fallback={<View />} />
        </View>
        <View
          style={local.dots}
          accessible
          accessibilityRole="text"
          accessibilityLabel={t("onboarding.progress", { current: page + 1, total: INTRO_PAGE_COUNT })}
        >
          {INTRO_PAGES.map((_, index) => (
            <View
              key={index}
              style={[
                local.dot,
                index === page ? { width: 22, backgroundColor: theme.colors.onHero } : { backgroundColor: "rgba(255,255,255,0.5)" },
              ]}
            />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={local.introCopy} bounces={false}>
        <Animated.View
          style={{
            gap: spacing.md,
            opacity: enter,
            transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
          }}
        >
          <AppText ref={titleRef} variant="displayHero" accessibilityRole="header">{t(content.title)}</AppText>
          <AppText variant="body" tone="muted" style={local.introBody}>{t(content.body)}</AppText>
        </Animated.View>
      </ScrollView>

      <View style={[local.introActions, { paddingBottom: bottomInset + spacing.sm }]}>
        <View style={local.skip}>
          <Button title={t("onboarding.skip")} variant="ghost" tone="muted" onPress={onSkip} />
        </View>
        <View style={local.introPrimary}>
          <Button title={last ? t("onboarding.getStarted") : t("onboarding.continue")} onPress={onNext} />
        </View>
      </View>
    </View>
  );
}

const BENEFITS: { icon: { ios: string; android: string; web: string }; title: MessageKey; body: MessageKey }[] = [
  { icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" }, title: "onboarding.notifications.alerts.title", body: "onboarding.notifications.alerts.body" },
  { icon: { ios: "arrow.forward", android: "arrow_forward", web: "arrow_forward" }, title: "onboarding.notifications.open.title", body: "onboarding.notifications.open.body" },
  { icon: { ios: "slider.horizontal.3", android: "tune", web: "tune" }, title: "onboarding.notifications.choice.title", body: "onboarding.notifications.choice.body" },
];

function NotificationStep({
  topInset,
  bottomInset,
  requesting,
  onTurnOn,
  onNotNow,
}: {
  topInset: number;
  bottomInset: number;
  requesting: boolean;
  onTurnOn: () => void;
  onNotNow: () => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const titleRef = useRef<Text>(null);
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
  }, []);

  // v3 `lfPulse 2.2s`: a soft ring that grows and fades behind the bell.
  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  return (
    <View style={[local.fill, { paddingTop: topInset }]}>
      <ScrollView contentContainerStyle={local.notifyContent}>
        <View style={local.bellWrap} accessible={false} importantForAccessibility="no-hide-descendants">
          <Animated.View
            style={[
              local.bell,
              local.bellPulse,
              {
                backgroundColor: theme.colors.selectedSurface,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
              },
            ]}
          />
          <View style={[local.bell, { backgroundColor: theme.colors.selectedSurface }]}>
            <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" } as never} size={40} tintColor={theme.colors.actionPrimary} fallback={<View />} />
          </View>
        </View>
        <AppText ref={titleRef} variant="displayPrompt" align="center" accessibilityRole="header" style={local.notifyTitle}>
          {t("onboarding.notifications.title")}
        </AppText>
        <AppText variant="body" tone="muted" align="center" style={[local.introBody, local.notifyBody]}>{t("onboarding.notifications.body")}</AppText>

        <View style={[local.benefits, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
          {BENEFITS.map((benefit, index) => (
            <View
              key={benefit.title}
              style={[local.benefit, index > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}
              accessible
              accessibilityLabel={`${t(benefit.title)}. ${t(benefit.body)}`}
            >
              <View style={[local.benefitIcon, { backgroundColor: theme.colors.selectedSurface }]}>
                <SymbolView name={benefit.icon as never} size={18} tintColor={theme.colors.actionPrimary} fallback={<View />} />
              </View>
              <View style={local.benefitCopy}>
                <AppText variant="bodyStrong">{t(benefit.title)}</AppText>
                <AppText variant="meta" tone="muted" style={local.benefitBody}>{t(benefit.body)}</AppText>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[local.notifyActions, { paddingBottom: bottomInset + spacing.sm }]}>
        <Button
          title={t("onboarding.notifications.turnOn")}
          onPress={onTurnOn}
          loading={requesting}
          accessibilityHint={t("onboarding.notifications.turnOnHint")}
        />
        <AppText variant="caption" tone="muted" align="center" style={local.osConfirm}>{t("onboarding.notifications.osConfirm")}</AppText>
        <Button title={t("onboarding.notifications.notNow")} variant="ghost" onPress={onNotNow} disabled={requesting} />
      </View>
    </View>
  );
}

const local = {
  root: { position: "absolute" as const, top: 0, bottom: 0, left: 0, right: 0 },
  fill: { position: "absolute" as const, top: 0, bottom: 0, left: 0, right: 0, flex: 1 },
  splash: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const },
  splashCenter: { alignItems: "center" as const, gap: 22 },
  // v3: 132pt white disc, 118pt mark, shadow 0 20 50 rgba(60,0,10,.35).
  splashLogo: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    boxShadow: "0px 20px 50px rgba(60,0,10,0.35)",
  },
  splashLogoImage: { width: 118, height: 118 },
  splashCopy: { alignItems: "center" as const, gap: 6 },
  splashSubtitle: { fontSize: 14, lineHeight: 19, opacity: 0.78 },
  splashFooter: { position: "absolute" as const, left: 0, right: 0 },
  splashFooterText: { opacity: 0.7 },
  // v3: bottom corners 32, night background behind the artwork.
  art: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    borderBottomStartRadius: 32,
    borderBottomEndRadius: 32,
  },
  artBadge: { width: 124, height: 124, borderRadius: 62, borderWidth: 1, alignItems: "center" as const, justifyContent: "center" as const },
  dots: { position: "absolute" as const, bottom: 22, flexDirection: "row" as const, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  // v3 copy: padding 30 24 0, gap 12; body 16/1.5.
  introCopy: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    paddingHorizontal: spacing.xxl,
    paddingTop: 30,
  },
  introBody: { fontSize: 16, lineHeight: 24 },
  // v3 actions: padding 12 20 8, gap 10; Skip (ghost, muted) + flexible primary.
  introActions: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  skip: { flexShrink: 0 },
  introPrimary: { flex: 1 },
  // v3 notify: padding 40 24 8.
  notifyContent: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: spacing.xxl,
    paddingTop: 40,
    paddingBottom: spacing.lg,
  },
  bellWrap: { width: 96, height: 96, marginTop: 30 },
  bell: { position: "absolute" as const, width: 96, height: 96, borderRadius: 48, alignItems: "center" as const, justifyContent: "center" as const },
  bellPulse: { top: 0, left: 0 },
  notifyTitle: { marginTop: 34 },
  notifyBody: { marginTop: spacing.md },
  benefits: { alignSelf: "stretch" as const, borderRadius: radius.xl, marginTop: 30, overflow: "hidden" as const },
  // v3: grid 36 | 1fr, gap 14, padding 14 16; 36pt tiles with radius 10.
  benefit: { flexDirection: "row" as const, alignItems: "center" as const, gap: 14, paddingVertical: 14, paddingHorizontal: spacing.lg },
  benefitIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const },
  benefitCopy: { flex: 1, minWidth: 0 },
  benefitBody: { marginTop: 2 },
  notifyActions: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    gap: spacing.xs,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  osConfirm: { marginTop: spacing.xs },
};
