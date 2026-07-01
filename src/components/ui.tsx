import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, useWindowDimensions, View } from "react-native";
import { storage } from "@/lib/storage";

const THEME_KEY = "lfa_theme";

const lightColors = {
  bg: "#F6F6F2",
  bgAlt: "#EEF1F6",
  panel: "#FFFFFF",
  panelSoft: "#F8FAFC",
  ink: "#151A2C",
  muted: "#7B879F",
  secondary: "#3E4A67",
  line: "#DBE0E8",
  primary: "#C8102E",
  primaryLight: "#E8112D",
  primaryDark: "#8B0018",
  green: "#007A3D",
  gold: "#C8A84B",
  danger: "#B42318",
  success: "#007A3D",
};

const darkColors: typeof lightColors = {
  bg: "#0F172A",
  bgAlt: "#111827",
  panel: "#172033",
  panelSoft: "#111827",
  ink: "#F8FAFC",
  muted: "#94A3B8",
  secondary: "#CBD5E1",
  line: "#334155",
  primary: "#E8112D",
  primaryLight: "#FF5A70",
  primaryDark: "#C8102E",
  green: "#22C55E",
  gold: "#F5C518",
  danger: "#EF4444",
  success: "#22C55E",
};

type ThemeMode = "light" | "dark";
type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  colors: typeof lightColors;
  styles: ReturnType<typeof createStyles>;
  toggleTheme: () => void;
};

let activeColors = lightColors;
let activeStyles = createStyles(activeColors);

export const colors = new Proxy(lightColors, {
  get(_target, prop: keyof typeof lightColors) {
    return activeColors[prop];
  },
}) as typeof lightColors;

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    void storage.get(THEME_KEY).then((value) => {
      if (value === "dark" || value === "light") setMode(value);
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const nextColors = mode === "dark" ? darkColors : lightColors;
    const nextStyles = createStyles(nextColors);
    activeColors = nextColors;
    activeStyles = nextStyles;
    return {
      mode,
      isDark: mode === "dark",
      colors: nextColors,
      styles: nextStyles,
      toggleTheme: () => {
        setMode((current) => {
          const next = current === "dark" ? "light" : "dark";
          void storage.set(THEME_KEY, next);
          return next;
        });
      },
    };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      mode: "light" as const,
      isDark: false,
      colors: activeColors,
      styles: activeStyles,
      toggleTheme: () => {},
    };
  }
  return context;
}

export function Screen({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={theme.styles.screen}><View style={theme.styles.bgAccentRed} /><View style={theme.styles.bgAccentGreen} />{children}</View>;
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

export function Input(props: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={theme.styles.inputWrap}>
      <Text style={theme.styles.label}>{props.label}</Text>
      <TextInput {...props} placeholderTextColor={theme.colors.muted} style={[theme.styles.input, props.style]} />
    </View>
  );
}

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
  screen: { flex: 1, backgroundColor: palette.bg, padding: 16, gap: 12, overflow: "hidden", alignItems: "center" },
  bgAccentRed: { position: "absolute", top: -80, left: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: isDark ? "rgba(200,16,46,0.18)" : "rgba(200,16,46,0.08)" },
  bgAccentGreen: { position: "absolute", top: -40, right: -90, width: 190, height: 190, borderRadius: 95, backgroundColor: isDark ? "rgba(34,197,94,0.12)" : "rgba(0,122,61,0.07)" },
  card: {
    backgroundColor: isDark ? "rgba(23,32,51,0.96)" : "rgba(255,255,255,0.96)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 16,
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: isDark ? 0.28 : 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
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
});
}

export const styles = new Proxy({} as ReturnType<typeof createStyles>, {
  get(_target, prop: keyof ReturnType<typeof createStyles>) {
    return activeStyles[prop];
  },
});
