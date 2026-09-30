import { AppText } from "@/components/foundation";
import { PitchArt } from "@/components/match/PitchArt";
import { Button, useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";
import { layout, radius, spacing } from "@/lib/designTokens";
import { INTRO_PAGE_COUNT, nextOnboardingStep, type OnboardingStep } from "@/lib/onboarding";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, BackHandler, Easing, ScrollView, useWindowDimensions, View, type Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** v3 easing `cubic-bezier(.22,1,.36,1)`. */
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

const INTRO_PAGES: { icon: { ios: string; android: string; web: string }; title: MessageKey; body: MessageKey }[] = [
  { icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" }, title: "onboarding.intro.matches.title", body: "onboarding.intro.matches.body" },
  { icon: { ios: "sportscourt", android: "stadium", web: "stadium" }, title: "onboarding.intro.seats.title", body: "onboarding.intro.seats.body" },
  { icon: { ios: "ticket", android: "confirmation_number", web: "confirmation_number" }, title: "onboarding.intro.tickets.title", body: "onboarding.intro.tickets.body" },
];

type Props = {
  /** Show the notification pre-prompt (the build has a push runtime). */
  offerNotifications: boolean;
  /**
   * The explicit "Turn on notifications" action. The only place onboarding
   * reaches the native permission prompt; the owner decides what that means
   * (it does not ask again when permission is already granted).
   */
  onTurnOnNotifications: () => Promise<unknown>;
  /** Onboarding is finished (flag written by the owner); Home is beneath. */
  onFinish: () => void;
};

/**
 * First-run flow (LFA Screen v3, after the launch splash): three product
 * pages → notification pre-prompt → Home. Presentation only: no navigation,
 * no data, and no permission request except through `onTurnOnNotifications`
 * after the user taps "Turn on notifications".
 */
export function OnboardingFlow({ offerNotifications, onTurnOnNotifications, onFinish }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<OnboardingStep>("intro");
  const [page, setPage] = useState(0);
  const [requesting, setRequesting] = useState(false);

  const finishIntro = useCallback(() => {
    const next = nextOnboardingStep("intro", offerNotifications);
    if (next === "done") onFinish();
    else setStep(next);
  }, [offerNotifications, onFinish]);

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
    <View style={[local.root, { backgroundColor: theme.colors.background }]} accessibilityViewIsModal>
      <StatusBar style={step === "intro" ? "light" : theme.isDark ? "light" : "dark"} />
      {step === "intro" ? (
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
