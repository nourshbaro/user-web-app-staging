import { storage } from "@/lib/storage";
import { adjacentPrimaryTab, getPrimaryTabTransitionDirection, PRIMARY_TAB_ROUTES, setPrimaryTabTransitionDirection, shouldShowBottomNavigation, type PrimaryTabRoute } from "@/lib/navigationPresentation";
import { darkColors, getThemeColors, lightColors, type ThemeMode } from "@/lib/themePalette";
import { router, usePathname } from "expo-router";
import { SymbolView } from "expo-symbols";
import { createContext, forwardRef, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, TextInputProps, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const THEME_KEY = "lfa_theme";

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
  const swipeGesture = useMemo(
    () => Gesture.Pan()
      .enabled(hasBottomNavigation)
      .activeOffsetX([-52, 52])
      .failOffsetY([-20, 20])
      .cancelsTouchesInView(false)
      .onEnd((event) => {
        if (Math.abs(event.translationX) < 72 && Math.abs(event.velocityX) < 550) return;
        scheduleOnRN(navigateAdjacent, event.translationX < 0 ? 1 : -1);
      }),
    [hasBottomNavigation, navigateAdjacent],
  );

  useEffect(() => {
    if (!hasBottomNavigation || reducedMotion) {
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    Animated.timing(entrance, { toValue: 1, duration: 190, useNativeDriver: true }).start();
  }, [entrance, hasBottomNavigation, pathname, reducedMotion]);

  return (
    <GestureDetector gesture={swipeGesture}>
      <Animated.View style={[
        theme.styles.screen,
        {
          paddingTop: Math.max(insets.top, 14),
          paddingBottom: hasBottomNavigation ? Math.max(insets.bottom, 12) + 74 : Math.max(insets.bottom, 12),
          opacity: entrance,
          transform: [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [10 * getPrimaryTabTransitionDirection(), 0] }) }],
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

export function Button({ title, onPress, variant = "primary", disabled }: { title: string; onPress?: () => void; variant?: "primary" | "secondary" | "danger"; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        theme.styles.button,
        variant === "secondary" && theme.styles.buttonSecondary,
        variant === "danger" && theme.styles.buttonDanger,
        disabled && theme.styles.buttonDisabled,
        pressed && !disabled && { opacity: 0.82 },
      ]}
    >
      <Text style={[theme.styles.buttonText, variant === "secondary" && theme.styles.buttonSecondaryText]}>{title}</Text>
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
    return (
      <View ref={containerRef} style={theme.styles.inputWrap}>
        <Text style={theme.styles.label}>{label}</Text>
        <TextInput ref={ref} {...props} placeholderTextColor={theme.colors.muted} style={[theme.styles.input, props.style]} />
      </View>
    );
  },
);

export function Empty({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme();
  return (
    <Card>
      <Text style={theme.styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={theme.styles.muted}>{detail}</Text> : null}
    </Card>
  );
}

export function Loading() {
  const theme = useTheme();
  return <View style={theme.styles.loading}><ActivityIndicator color={theme.colors.primary} /></View>;
}

function BottomNavigation({ bottomInset, onNavigate }: { bottomInset: number; onNavigate: (route: PrimaryTabRoute) => void }) {
  const pathname = usePathname();
  const theme = useTheme();

  const tabs: { label: string; href: PrimaryTabRoute; icon: any }[] = [
    { label: "Home", href: "/", icon: { ios: "house", android: "home", web: "home" } },
    { label: "Tournament", href: "/tournament", icon: { ios: "trophy", android: "emoji_events", web: "emoji_events" } },
    { label: "Matches", href: "/matches", icon: { ios: "sportscourt", android: "stadium", web: "stadium" } },
    { label: "My Tickets", href: "/tickets", icon: { ios: "ticket", android: "confirmation_number", web: "confirmation_number" } },
    { label: "Profile", href: "/profile", icon: { ios: "person", android: "person_outline", web: "person_outline" } },
  ];

  return (
    <>
      <View style={[theme.styles.bottomNav, { bottom: Math.max(bottomInset, 12), backgroundColor: theme.colors.bg, borderTopColor: theme.colors.line }]}>
        {tabs.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Pressable
              key={tab.href}
              onPress={() => {
                if (active) return;
                onNavigate(tab.href);
              }}
              style={[theme.styles.bottomNavItem, active && theme.styles.bottomNavItemActive]}
              accessibilityLabel={tab.label}
            >
              <View style={theme.styles.bottomNavIconWrap}>
                <SymbolView
                  name={tab.icon as any}
                  size={20}
                  tintColor={active ? theme.colors.primary : theme.colors.muted}
                  fallback={<Text style={[theme.styles.bottomNavFallback, { color: active ? theme.colors.primary : theme.colors.muted }]}>{tab.label.slice(0, 1)}</Text>}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
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
      boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, spreadDistance: 0, color: isDark ? "rgba(0,0,0,0.34)" : "rgba(15,23,42,0.14)" }],
      shadowColor: isDark ? "#000000" : "#0F172A",
      shadowOpacity: isDark ? 0.28 : 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    title: { color: palette.ink, fontSize: 24, fontWeight: "900", lineHeight: 30 },
    h2: { color: palette.ink, fontSize: 18, fontWeight: "800" },
    text: { color: palette.ink, fontSize: 15 },
    muted: { color: palette.muted, fontSize: 13, lineHeight: 19 },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderColor: palette.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: isDark ? "rgba(17,24,39,0.8)" : "rgba(255,255,255,0.8)" },
    chipActive: { borderColor: palette.primary, backgroundColor: "rgba(200,16,46,0.08)" },
    chipText: { color: palette.ink, fontSize: 13, fontWeight: "600" },
    button: { minHeight: 46, borderRadius: 14, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    buttonSecondary: { backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line },
    buttonDanger: { backgroundColor: palette.danger },
    buttonDisabled: { backgroundColor: isDark ? "#334155" : "#D8DEE8", borderColor: isDark ? "#334155" : "#D8DEE8" },
    buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
    buttonSecondaryText: { color: palette.ink },
    inputWrap: { gap: 6 },
    label: { color: palette.ink, fontSize: 13, fontWeight: "700" },
    input: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, color: palette.ink, paddingHorizontal: 12, fontSize: 15 },
    emptyTitle: { color: palette.ink, fontSize: 17, fontWeight: "700" },
    loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.bg },
    sectionLabel: { color: palette.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
    badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(200,16,46,0.09)" },
    badgeText: { color: palette.primary, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
    bottomNav: {
      position: "absolute",
      left: 14,
      right: 14,
      bottom: 12,
      height: 62,
      borderTopWidth: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-around",
      shadowColor: "#000000",
      shadowOpacity: 0,
      elevation: 0,
    },
    bottomNavItem: {
      flex: 1,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      borderRadius: 14,
    },
    bottomNavIconWrap: {
      width: 42,
      height: 26,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    },
    bottomNavBadge: {
      position: "absolute",
      top: -4,
      right: 4,
      minWidth: 15,
      height: 15,
      borderRadius: 8,
      paddingHorizontal: 4,
      borderWidth: 2,
      alignItems: "center",
      justifyContent: "center",
    },
    bottomNavBadgeText: {
      color: "#FFFFFF",
      fontSize: 8,
      lineHeight: 9,
      fontWeight: "900",
    },
    bottomNavItemActive: {
      backgroundColor: isDark ? "rgba(232,17,45,0.14)" : "rgba(200,16,46,0.08)",
    },
    bottomNavText: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "800",
    },
    bottomNavFallback: {
      fontSize: 14,
      fontWeight: "900",
    },
    reservationPill: {
      position: "absolute",
      right: 22,
      bottom: 82,
      minHeight: 34,
      borderRadius: 17,
      borderWidth: 1,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      shadowColor: "#000000",
      shadowOpacity: isDark ? 0.24 : 0.09,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 5,
    },
    reservationLabel: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "900",
      textTransform: "uppercase",
    },
    reservationTime: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: "900",
    },
  });
}
