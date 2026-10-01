import { storage } from "@/lib/storage";
import { adjacentPrimaryTab, PRIMARY_TAB_ROUTES, setPrimaryTabTransitionDirection, shouldShowBottomNavigation, swipeTabStep, type PrimaryTabRoute } from "@/lib/navigationPresentation";
import { darkColors, getThemeColors, lightColors, type ThemeMode } from "@/lib/themePalette";
import { router, usePathname } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages/en";
import { radius, size, spacing, typography } from "@/lib/designTokens";
import { fontStyleFor } from "@/lib/fontFamilies";
import { createContext, forwardRef, PropsWithChildren, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import type { RefObject } from "react";
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, Text, TextInput, TextInputProps, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const THEME_KEY = "lfa_theme";

const BUTTON_RADIUS = Platform.OS === "android" ? 20 : 14;

/** v3 `lfEnter` for tab switches. */
const TAB_ENTER_MS = 280;
const TAB_ENTER_RISE = 10;

/** v3 tab bar: Android uses the Material-style indicator pill; iOS and web the flat icon row. */
const ANDROID_NAV = Platform.OS === "android";

/** Visible-label tab row (v3): icon + label + spacing, ≥ the 48pt touch target. */
const BOTTOM_NAV_ROW_HEIGHT = ANDROID_NAV ? 58 : 50;

function bottomNavBottomPadding(bottomInset: number) {
  return Math.max(bottomInset, spacing.sm);
}

/** Total height the bottom navigation occupies, so screen content can clear it. */
function bottomNavHeight(bottomInset: number) {
  return spacing.xs + BOTTOM_NAV_ROW_HEIGHT + bottomNavBottomPadding(bottomInset) + 1;
}

export type { ThemeColors } from "@/lib/themePalette";
type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  colors: typeof lightColors;
  styles: ReturnType<typeof createStyles>;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
};

const defaultStyles = createStyles(lightColors);

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    void storage.get(THEME_KEY).then((value) => {
      if (value === "system" || value === "dark" || value === "light") setModeState(value);
    });
  }, []);

  const resolvedMode = mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;
  const themeColors = getThemeColors(resolvedMode);
  const themeStyles = useMemo(() => createStyles(themeColors), [themeColors]);
  const value = useMemo<ThemeContextValue>(() => {
    return {
      mode,
      isDark: resolvedMode === "dark",
      colors: themeColors,
      styles: themeStyles,
      toggleTheme: () => {
        setModeState((current) => {
          const next = (current === "dark" || (current === "system" && resolvedMode === "dark")) ? "light" : "dark";
          void storage.set(THEME_KEY, next);
          return next;
        });
      },
      setMode: (next) => {
        setModeState(next);
        void storage.set(THEME_KEY, next);
      },
    };
  }, [mode, resolvedMode, themeColors, themeStyles]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      mode: "light" as const,
      isDark: false,
      colors: lightColors,
      styles: defaultStyles,
      toggleTheme: () => { },
      setMode: () => { },
    };
  }
  return context;
}

export function Screen({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const hasBottomNavigation = shouldShowBottomNavigation(pathname);
  const reducedMotion = useReducedMotion();
  const { isRTL } = useI18n();
  const [entrance] = useState(() => new Animated.Value(0));
  const navigateToTab = useCallback((destination: PrimaryTabRoute) => {
    if (destination === pathname) return;
    const currentIndex = PRIMARY_TAB_ROUTES.indexOf(pathname as PrimaryTabRoute);
    const destinationIndex = PRIMARY_TAB_ROUTES.indexOf(destination);
    setPrimaryTabTransitionDirection(destinationIndex >= currentIndex ? 1 : -1);
    router.replace(destination);
  }, [pathname]);
  const navigateAdjacent = useCallback((direction: -1 | 1) => {
    const destination = adjacentPrimaryTab(pathname, direction);
    if (destination) navigateToTab(destination);
  }, [navigateToTab, pathname]);
  // The tab row mirrors in RTL, so the swipe that reveals the next tab mirrors too.
  const navigateBySwipe = useCallback((translationX: number) => {
    navigateAdjacent(swipeTabStep(translationX, isRTL));
  }, [isRTL, navigateAdjacent]);
  const swipeGesture = useMemo(
    () => Gesture.Pan()
      .enabled(hasBottomNavigation)
      .activeOffsetX([-52, 52])
      .failOffsetY([-20, 20])
      .cancelsTouchesInView(false)
      .onEnd((event) => {
        if (Math.abs(event.translationX) < 72 && Math.abs(event.velocityX) < 550) return;
        scheduleOnRN(navigateBySwipe, event.translationX);
      }),
    [hasBottomNavigation, navigateBySwipe],
  );

  useEffect(() => {
    if (!hasBottomNavigation || reducedMotion) {
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    // v3 `lfEnter`: fade + 10pt rise over 280ms (direction-neutral, so identical in RTL).
    Animated.timing(entrance, { toValue: 1, duration: TAB_ENTER_MS, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true }).start();
  }, [entrance, hasBottomNavigation, pathname, reducedMotion]);

  return (
    <GestureDetector gesture={swipeGesture}>
      <Animated.View style={[
        theme.styles.screen,
        {
          paddingTop: Math.max(insets.top, 14),
          paddingBottom: hasBottomNavigation ? bottomNavHeight(insets.bottom) + spacing.sm : Math.max(insets.bottom, 12),
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [TAB_ENTER_RISE, 0] }) }],
        },
      ]}>
        {children}
        {hasBottomNavigation ? <BottomNavigation bottomInset={insets.bottom} onNavigate={navigateToTab} /> : null}
      </Animated.View>
    </GestureDetector>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={theme.styles.card}>{children}</View>;
}

type ButtonProps = {
  title: string;
  onPress?: () => void;
  /** `ghost`: v3 text button (no fill), e.g. "Not now" / "Skip". */
  variant?: "primary" | "secondary" | "danger" | "ghost" | "tonal";
  /** Ghost text tone: `muted` (v3 Skip) or the default strong ink (v3 Not now). */
  tone?: "strong" | "muted";
  disabled?: boolean;
  /** Owner's in-flight flag: shows a spinner, blocks presses, and reports busy to assistive tech. */
  loading?: boolean;
  /** Defaults to `title`; override only when the visible text is ambiguous out of context. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Decorative leading glyph (e.g. the v3 lock on "Pay"); hidden from assistive tech. */
  icon?: React.ReactNode;
};

export function Button({ title, onPress, variant = "primary", tone = "strong", disabled, loading = false, accessibilityLabel, accessibilityHint, icon }: ButtonProps) {
  const theme = useTheme();
  const { meta } = useI18n();
  const reducedMotion = useReducedMotion();
  const inactive = Boolean(disabled || loading);
  const ghost = variant === "ghost";
  // v3 `--bg2` filled secondary ("Back to cart", "Change payment method").
  const tonal = variant === "tonal";
  const textColor = inactive && !ghost
    ? theme.colors.disabledText
    : ghost || tonal
      ? (tone === "muted" ? theme.colors.textMuted : theme.colors.textStrong)
      : variant === "secondary"
      ? theme.colors.onActionSecondary
      : variant === "danger"
        ? theme.colors.onActionDestructive
        : theme.colors.onActionPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      // aria-* state props work on native (RN ≥ 0.71) and web; react-native-web ignores `accessibilityState`.
      aria-disabled={inactive}
      aria-busy={loading}
      style={({ pressed }) => [
        theme.styles.button,
        variant === "secondary" && theme.styles.buttonSecondary,
        variant === "danger" && theme.styles.buttonDanger,
        ghost && theme.styles.buttonGhost,
        tonal && { backgroundColor: theme.colors.bgAlt },
        inactive && (ghost ? { opacity: 0.4 } : theme.styles.buttonDisabled),
        // v3 press: a slight scale-down (opacity under reduced motion); instant, never delays onPress.
        pressed && !inactive && (reducedMotion ? { opacity: 0.82 } : { transform: [{ scale: 0.98 }] }),
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} accessibilityElementsHidden importantForAccessibility="no" />
      ) : icon ? (
        <View accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{icon}</View>
      ) : null}
      <Text style={[theme.styles.buttonText, fontStyleFor("text", ghost ? "500" : typography.action.fontWeight, meta.script), { color: textColor }]}>{title}</Text>
    </Pressable>
  );
}

export const Input = forwardRef<TextInput, TextInputProps & {
  label: string;
  /** Ref to the outer label+input wrapper — e.g. for BottomSheetModal's `scrollFieldIntoView`, which needs the whole field group's position, not just the input's. */
  containerRef?: RefObject<View | null>;
}>(
  function Input({ label, containerRef, ...props }, ref) {
    const theme = useTheme();
    const labelId = `input-label-${useId()}`;
    return (
      <View ref={containerRef} style={theme.styles.inputWrap}>
        <Text nativeID={labelId} style={theme.styles.label}>{label}</Text>
        <TextInput
          ref={ref}
          // The visible label names the field for assistive tech unless the caller overrides it.
          accessibilityLabel={label}
          accessibilityLabelledBy={labelId}
          {...props}
          placeholderTextColor={theme.colors.muted}
          style={[theme.styles.input, props.style]}
        />
      </View>
    );
  },
);

export function Empty({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme();
  return (
    <Card>
      <Text accessibilityRole="header" style={theme.styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={[theme.styles.muted, { color: theme.colors.textMuted }]}>{detail}</Text> : null}
    </Card>
  );
}

/** Full-area loading indicator; announced once as a busy progress element, not repeatedly. */
export function Loading({ label }: { label?: string } = {}) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View
      style={theme.styles.loading}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t("common.loading")}
      aria-busy
    >
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}

function BottomNavigation({ bottomInset, onNavigate }: { bottomInset: number; onNavigate: (route: PrimaryTabRoute) => void }) {
  const pathname = usePathname();
  const theme = useTheme();
  const { t } = useI18n();

  // Same order as PRIMARY_TAB_ROUTES (reading order; swipe follows it).
  const tabs: { labelKey: MessageKey; href: PrimaryTabRoute; icon: any }[] = [
    { labelKey: "nav.home", href: "/", icon: { ios: "house", android: "home", web: "home" } },
    { labelKey: "nav.matches", href: "/matches", icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" } },
    { labelKey: "nav.tickets", href: "/tickets", icon: { ios: "ticket", android: "confirmation_number", web: "confirmation_number" } },
    { labelKey: "nav.competitions", href: "/competitions", icon: { ios: "trophy", android: "emoji_events", web: "emoji_events" } },
    { labelKey: "nav.profile", href: "/profile", icon: { ios: "person", android: "person_outline", web: "person_outline" } },
  ];

  return (
    <View
      style={[
        theme.styles.bottomNav,
        {
          paddingBottom: bottomNavBottomPadding(bottomInset),
          // v3: translucent `--bar` with a hairline edge on iOS/web; flat `--card2` on Android.
          backgroundColor: ANDROID_NAV ? theme.colors.panelSoft : theme.colors.bar,
          borderTopColor: ANDROID_NAV ? "transparent" : theme.colors.hairline,
        },
      ]}
    >
      <View accessibilityRole="tablist" accessibilityLabel={t("nav.primary")} style={theme.styles.bottomNavRow}>
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const label = t(tab.labelKey);
          return (
            <Pressable
              key={tab.href}
              onPress={() => {
                if (active) return;
                onNavigate(tab.href);
              }}
              style={theme.styles.bottomNavItem}
              accessibilityRole="tab"
              accessibilityLabel={label}
              aria-selected={active}
            >
              <TabItem active={active} label={label} icon={tab.icon} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * One tab's icon and visible label, per v3: iOS shows a 26pt icon (no pill)
 * and a 10pt label; Android a 64x32 indicator pill that grows in behind the
 * icon and a 12pt label. The newly selected icon gives a short bounce. All
 * motion is skipped under reduced motion. Selection is also shown by weight
 * and (Android) the pill, never colour alone.
 */
function TabItem({ active, label, icon }: { active: boolean; label: string; icon: unknown }) {
  const theme = useTheme();
  const { meta } = useI18n();
  const reducedMotion = useReducedMotion();
  const [bounce] = useState(() => new Animated.Value(1));
  const [indicator] = useState(() => new Animated.Value(active ? 1 : 0));
  const color = active ? theme.colors.actionPrimary : theme.colors.textMuted;

  useEffect(() => {
    if (!active || reducedMotion) {
      bounce.setValue(1);
      indicator.setValue(active ? 1 : 0);
      return;
    }
    indicator.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(bounce, { toValue: 0.84, duration: 150, useNativeDriver: true }),
        Animated.spring(bounce, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 12 }),
      ]),
      Animated.timing(indicator, { toValue: 1, duration: 280, useNativeDriver: false }),
    ]).start();
  }, [active, bounce, indicator, reducedMotion]);

  const glyph = (
    <Animated.View style={{ transform: [{ scale: bounce }] }}>
      <SymbolView
        name={icon as any}
        size={ANDROID_NAV ? 22 : 26}
        tintColor={color}
        fallback={<Text style={[theme.styles.bottomNavFallback, { color }]}>{label.slice(0, 1)}</Text>}
      />
    </Animated.View>
  );

  return (
    <>
      {ANDROID_NAV ? (
        <View style={theme.styles.bottomNavIconWrap}>
          {/* Selected = indicator pill + weight + colour, never colour alone. */}
          {active ? (
            <Animated.View
              style={[
                theme.styles.bottomNavIndicator,
                {
                  backgroundColor: theme.colors.selectedSurface,
                  opacity: indicator,
                  width: indicator.interpolate({ inputRange: [0, 1], outputRange: [28, 64] }),
                },
              ]}
            />
          ) : null}
          {glyph}
        </View>
      ) : glyph}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={1.3}
        // Selected = heavier weight too (never colour alone).
        style={[theme.styles.bottomNavText, fontStyleFor("text", active ? (ANDROID_NAV ? "700" : "600") : "500", meta.script), { color }]}
      >
        {label}
      </Text>
    </>
  );
}

export function useResponsive() {
  const { width } = useWindowDimensions();
  const availableWidth = Math.max(width - 32, 0);
  return {
    width,
    isNarrow: width < 390,
    isTablet: width >= 768,
    isDesktop: width >= 1024,
    contentWidth: Math.min(availableWidth, 1180),
  };
}

function createStyles(palette: typeof lightColors) {
  const isDark = palette.bg === darkColors.bg;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.bg, padding: 14, paddingBottom: 86, gap: 12, overflow: "hidden", alignItems: "center" },
    card: {
      backgroundColor: palette.panel,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? palette.line : "#E3E7EE",
      padding: 16,
      gap: 10,
      // `boxShadow` renders on iOS, Android and web; the legacy shadow*/elevation
      // pair it duplicated drew a second shadow on native.
      boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, spreadDistance: 0, color: isDark ? "rgba(0,0,0,0.34)" : "rgba(15,23,42,0.14)" }],
    },
    title: { color: palette.ink, fontSize: 24, fontWeight: "900", lineHeight: 30 },
    text: { color: palette.ink, fontSize: 15 },
    muted: { color: palette.muted, fontSize: 13, lineHeight: 19 },
    button: {
      minHeight: size.controlHeight,
      // v3 `--btnR`: 14 on iOS, 20 on Android.
      borderRadius: BUTTON_RADIUS,
      backgroundColor: palette.actionPrimary,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    buttonSecondary: { backgroundColor: palette.actionSecondary, borderWidth: 1, borderColor: palette.border },
    buttonGhost: { backgroundColor: "transparent" },
    buttonDanger: { backgroundColor: palette.actionDestructive },
    buttonDisabled: { backgroundColor: palette.disabledSurface, borderColor: palette.disabledSurface },
    // Color is applied per state in <Button>; text may wrap for long (e.g. Arabic) labels.
    // Family/weight come from `fontStyleFor` in <Button>.
    buttonText: { color: palette.onActionPrimary, fontSize: typography.action.fontSize, lineHeight: typography.action.lineHeight, textAlign: "center", flexShrink: 1 },
    inputWrap: { gap: 6 },
    label: { color: palette.ink, fontSize: 13, fontWeight: "700" },
    input: { minHeight: size.controlHeight, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.ink, paddingHorizontal: 12, fontSize: 15 },
    emptyTitle: { color: palette.ink, fontSize: 17, fontWeight: "700" },
    loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.bg },
    // Anchored to the bottom edge; the bar pads itself for the home indicator.
    bottomNav: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: ANDROID_NAV ? spacing.md : 7,
      alignItems: "center",
    },
    bottomNavRow: {
      width: "100%",
      maxWidth: 640,
      height: BOTTOM_NAV_ROW_HEIGHT,
      flexDirection: "row",
      alignItems: "stretch",
      paddingHorizontal: spacing.xs,
    },
    bottomNavItem: {
      flex: 1,
      minWidth: 0,
      minHeight: size.touchTarget,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xxs,
      paddingHorizontal: spacing.xxs,
    },
    bottomNavIconWrap: {
      width: 64,
      height: 32,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    },
    bottomNavIndicator: {
      position: "absolute",
      top: 0,
      bottom: 0,
      borderRadius: 16,
    },
    bottomNavText: {
      maxWidth: "100%",
      fontSize: ANDROID_NAV ? 12 : 10,
      lineHeight: ANDROID_NAV ? 15 : 13,
      textAlign: "center",
    },
    bottomNavFallback: {
      fontSize: 14,
      fontWeight: "900",
    },
  });
}
