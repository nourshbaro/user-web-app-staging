import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, useWindowDimensions, View } from "react-native";

export const colors = {
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

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}><View style={styles.bgAccentRed} /><View style={styles.bgAccentGreen} />{children}</View>;
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({ title, onPress, variant = "primary", disabled }: { title: string; onPress?: () => void; variant?: "primary" | "secondary" | "danger"; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && { opacity: 0.82 },
      ]}
    >
      <Text style={[styles.buttonText, variant === "secondary" && styles.buttonSecondaryText]}>{title}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label: string }) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput {...props} placeholderTextColor="#98A2B3" style={[styles.input, props.style]} />
    </View>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.muted}>{detail}</Text> : null}
    </Card>
  );
}

export function Loading() {
  return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
}

export function useResponsive() {
  const { width } = useWindowDimensions();
  return {
    width,
    isNarrow: width < 390,
    isTablet: width >= 768,
    contentWidth: Math.min(width - 32, 680),
  };
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12, overflow: "hidden", alignItems: "center" },
  bgAccentRed: { position: "absolute", top: -80, left: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(200,16,46,0.08)" },
  bgAccentGreen: { position: "absolute", top: -40, right: -90, width: 190, height: 190, borderRadius: 95, backgroundColor: "rgba(0,122,61,0.07)" },
  card: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900", lineHeight: 30 },
  h2: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  text: { color: colors.ink, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "rgba(255,255,255,0.8)" },
  chipActive: { borderColor: colors.primary, backgroundColor: "rgba(200,16,46,0.08)" },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  button: { minHeight: 46, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonSecondary: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line },
  buttonDanger: { backgroundColor: colors.danger },
  buttonDisabled: { backgroundColor: "#D8DEE8", borderColor: "#D8DEE8" },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  buttonSecondaryText: { color: colors.ink },
  inputWrap: { gap: 6 },
  label: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  input: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, color: colors.ink, paddingHorizontal: 12, fontSize: 15 },
  emptyTitle: { color: colors.ink, fontSize: 17, fontWeight: "700" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  sectionLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "rgba(200,16,46,0.09)" },
  badgeText: { color: colors.primary, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
});
