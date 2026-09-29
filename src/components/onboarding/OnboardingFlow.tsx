import { AppText, usePressFeedback } from "@/components/foundation";
import { PitchArt } from "@/components/match/PitchArt";
import { Button, useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";
import { layout, motion, radius, size, spacing } from "@/lib/designTokens";
import { INTRO_PAGE_COUNT, type OnboardingStep } from "@/lib/onboarding";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, BackHandler, Image, Pressable, ScrollView, View, type Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The splash advances on its own after this long (or on a tap), unless a screen reader is running. */
const SPLASH_HOLD_MS = 1400;

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
 * First-run flow: splash → three product pages → notification pre-prompt.
 * Presentation only: no navigation, no data, and no permission request except
 * through `onTurnOnNotifications` after the user taps "Turn on notifications".
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
      style={[local.root, { backgroundColor: step === "splash" ? theme.colors.brandSurface : theme.colors.bg }]}
      accessibilityViewIsModal
    >
      <StatusBar style={step === "notifications" ? (theme.isDark ? "light" : "dark") : "light"} />
      {step === "splash" ? (
        <SplashStep topInset={insets.top} bottomInset={insets.bottom} onContinue={showIntro} />
      ) : step === "intro" ? (
        <IntroStep
          page={page}
          topInset={insets.top}
          bottomInset={insets.bottom}
          onSkip={finishIntro}
          onNext={next}
        />
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

function SplashStep({ topInset, bottomInset, onContinue }: { topInset: number; bottomInset: number; onContinue: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [appear] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));

  useEffect(() => {
    if (reducedMotion) {
      appear.setValue(1);
      return;
    }
    Animated.timing(appear, { toValue: 1, duration: motion.sheet * 2, useNativeDriver: true }).start();
  }, [appear, reducedMotion]);

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

  return (
    <Pressable
      onPress={onContinue}
      accessibilityRole="button"
      accessibilityLabel={t("onboarding.splash.a11y")}
      style={[local.splash, { paddingTop: topInset + spacing.xxl, paddingBottom: bottomInset + spacing.xxl }]}
    >
      <Animated.View
        style={[
          local.splashCenter,
          { opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] },
        ]}
      >
        <View style={[local.splashLogo, { backgroundColor: theme.colors.scanSurface }]}>
          <Image source={require("../../../assets/images/lfa-logo.png")} style={local.splashLogoImage} resizeMode="contain" />
        </View>
        <View style={local.splashCopy}>
          <AppText variant="displayTitle" align="center" style={{ color: theme.colors.onBrandSurface }}>{t("onboarding.splash.title")}</AppText>
          <AppText variant="body" align="center" style={{ color: theme.colors.onBrandSurface }}>{t("onboarding.splash.subtitle")}</AppText>
        </View>
      </Animated.View>
      <AppText variant="caption" align="center" style={{ color: theme.colors.onBrandSurface }}>{t("onboarding.splash.footer")}</AppText>
    </Pressable>
  );
}

function IntroStep({
  page,
  topInset,
  bottomInset,
  onSkip,
  onNext,
}: {
  page: number;
  topInset: number;
  bottomInset: number;
  onSkip: () => void;
  onNext: () => void;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const pressFeedback = usePressFeedback();
  const content = INTRO_PAGES[page];
  const titleRef = useRef<Text>(null);
  const last = page === INTRO_PAGE_COUNT - 1;

  // Each page change moves the screen reader to the new title.
  useEffect(() => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
  }, [page]);

  return (
    <View style={local.fill}>
      <View style={[local.art, { backgroundColor: theme.colors.hero, paddingTop: topInset + spacing.xl }]}>
        <PitchArt />
        <View style={[local.artBadge, { backgroundColor: theme.colors.heroRaised, borderColor: theme.colors.heroHairline }]}>
          <SymbolView name={content.icon as never} size={44} tintColor={theme.colors.onHero} fallback={<View />} />
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
                index === page
                  ? { width: 22, backgroundColor: theme.colors.onHero }
                  : { backgroundColor: theme.colors.heroHairline },
              ]}
            />
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={local.introCopy} bounces={false}>
        <AppText ref={titleRef} variant="hero" accessibilityRole="header">{t(content.title)}</AppText>
        <AppText variant="body" tone="muted">{t(content.body)}</AppText>
      </ScrollView>

      <View style={[local.introActions, { paddingBottom: bottomInset + spacing.lg }]}>
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.skip")}
          hitSlop={8}
          style={({ pressed }) => [local.skip, pressFeedback(pressed)]}
        >
          <AppText variant="bodyStrong" tone="muted">{t("onboarding.skip")}</AppText>
        </Pressable>
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
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
  }, []);

  return (
    <View style={[local.fill, { paddingTop: topInset }]}>
      <ScrollView contentContainerStyle={local.notifyContent}>
        <View style={[local.bell, { backgroundColor: theme.colors.tones.brand.bg }]} accessible={false} importantForAccessibility="no-hide-descendants">
          <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" } as never} size={34} tintColor={theme.colors.tones.brand.fg} fallback={<View />} />
        </View>
        <AppText ref={titleRef} variant="hero" align="center" accessibilityRole="header">{t("onboarding.notifications.title")}</AppText>
        <AppText variant="body" tone="muted" align="center">{t("onboarding.notifications.body")}</AppText>

        <View style={[local.benefits, { backgroundColor: theme.colors.surface, borderColor: theme.colors.hairline }]}>
          {BENEFITS.map((benefit, index) => (
            <View
              key={benefit.title}
              style={[local.benefit, index > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}
              accessible
              accessibilityLabel={`${t(benefit.title)}. ${t(benefit.body)}`}
            >
              <View style={[local.benefitIcon, { backgroundColor: theme.colors.surfaceSecondary }]}>
                <SymbolView name={benefit.icon as never} size={18} tintColor={theme.colors.textStrong} fallback={<View />} />
              </View>
              <View style={local.benefitCopy}>
                <AppText variant="bodyStrong">{t(benefit.title)}</AppText>
                <AppText variant="meta" tone="muted">{t(benefit.body)}</AppText>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[local.notifyActions, { paddingBottom: bottomInset + spacing.lg }]}>
        <Button
          title={t("onboarding.notifications.turnOn")}
          onPress={onTurnOn}
          loading={requesting}
          accessibilityHint={t("onboarding.notifications.turnOnHint")}
        />
        <AppText variant="caption" tone="muted" align="center">{t("onboarding.notifications.osConfirm")}</AppText>
        <Button title={t("onboarding.notifications.notNow")} variant="secondary" onPress={onNotNow} disabled={requesting} />
      </View>
    </View>
  );
}

const local = {
  root: { position: "absolute" as const, top: 0, bottom: 0, left: 0, right: 0 },
  fill: { flex: 1 },
  splash: { flex: 1, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: spacing.xxl },
  splashCenter: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, gap: spacing.xxl },
  splashLogo: { width: 132, height: 132, borderRadius: 66, alignItems: "center" as const, justifyContent: "center" as const },
  splashLogoImage: { width: 96, height: 96 },
  splashCopy: { alignItems: "center" as const, gap: spacing.xs },
  art: {
    flex: 1.15,
    minHeight: 220,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    borderBottomStartRadius: radius.xxl,
    borderBottomEndRadius: radius.xxl,
  },
  artBadge: { width: 112, height: 112, borderRadius: 56, borderWidth: 1, alignItems: "center" as const, justifyContent: "center" as const },
  dots: { position: "absolute" as const, bottom: spacing.xl, flexDirection: "row" as const, gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3 },
  introCopy: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
  },
  introActions: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  skip: { minHeight: size.touchTarget, justifyContent: "center" as const, paddingHorizontal: spacing.xs },
  introPrimary: { flex: 1 },
  notifyContent: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.lg,
  },
  bell: { width: 84, height: 84, borderRadius: 42, alignItems: "center" as const, justifyContent: "center" as const, marginBottom: spacing.sm },
  benefits: { alignSelf: "stretch" as const, borderRadius: radius.xl, borderWidth: 1, marginTop: spacing.md },
  benefit: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, padding: spacing.lg },
  benefitIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center" as const, justifyContent: "center" as const },
  benefitCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  notifyActions: {
    width: "100%" as const,
    maxWidth: layout.readableWidth,
    alignSelf: "center" as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
};
