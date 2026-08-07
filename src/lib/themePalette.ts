export type ThemeColors = {
  bg: string;
  bgAlt: string;
  panel: string;
  panelSoft: string;
  ink: string;
  muted: string;
  secondary: string;
  line: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  green: string;
  gold: string;
  danger: string;
  success: string;
};

export const lightColors: ThemeColors = {
  bg: "#F5F6F8",
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
export type ThemeMode = "light" | "dark";

export const darkColors: ThemeColors = {
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

export function getThemeColors(mode: ThemeMode): ThemeColors {
  return mode === "dark" ? darkColors : lightColors;
}
