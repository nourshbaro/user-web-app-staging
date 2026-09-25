/**
 * Semantic status tones. Presentation vocabulary only: mapping a backend
 * status (match, ticket, seat) to a tone belongs to the screen that owns that
 * data, never to this palette.
 */
export type StatusTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "live"
  | "unavailable";

export type ToneColors = { fg: string; bg: string; border: string };

export type ThemeColors = {
  // Legacy roles — used across existing screens; keep until each screen is redesigned.
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

  // Semantic roles — preferred for new and redesigned UI.
  background: string;
  surface: string;
  surfaceSecondary: string;
  textStrong: string;
  /** AA-compliant secondary text (≥ 4.5:1 on surface and background). */
  textMuted: string;
  textInverse: string;
  border: string;
  divider: string;
  actionPrimary: string;
  actionPrimaryPressed: string;
  onActionPrimary: string;
  actionSecondary: string;
  onActionSecondary: string;
  actionDestructive: string;
  onActionDestructive: string;
  disabledSurface: string;
  disabledText: string;
  selectedSurface: string;
  focusRing: string;
  hero: string;
  onHero: string;
  onHeroMuted: string;
  skeleton: string;
  skeletonHighlight: string;
  scrim: string;
  /** Fixed light backdrop for scannable content (QR) in both themes. */
  scanSurface: string;
  tones: Record<StatusTone, ToneColors>;
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

  background: "#F5F6F8",
  surface: "#FFFFFF",
  surfaceSecondary: "#EEF1F6",
  textStrong: "#151A2C",
  textMuted: "#535D72",
  textInverse: "#FFFFFF",
  border: "#DBE0E8",
  divider: "#E6E9EF",
  actionPrimary: "#C8102E",
  actionPrimaryPressed: "#A50D26",
  onActionPrimary: "#FFFFFF",
  actionSecondary: "#FFFFFF",
  onActionSecondary: "#151A2C",
  actionDestructive: "#B42318",
  onActionDestructive: "#FFFFFF",
  disabledSurface: "#D8DEE8",
  disabledText: "#4A5366",
  selectedSurface: "#FBE9EC",
  focusRing: "#1D4F91",
  hero: "#0F1216",
  onHero: "#FFFFFF",
  onHeroMuted: "#B8BEC8",
  skeleton: "#E3E7EE",
  skeletonHighlight: "#EEF1F6",
  scrim: "rgba(15,18,22,0.48)",
  scanSurface: "#FFFFFF",
  tones: {
    neutral: { fg: "#3E4A67", bg: "#EEF1F6", border: "#DBE0E8" },
    brand: { fg: "#A10E26", bg: "#FBE6EA", border: "#F2BCC6" },
    success: { fg: "#0B6B3A", bg: "#E3F5EA", border: "#B7E2C7" },
    warning: { fg: "#7A4A00", bg: "#FFF2D6", border: "#F4D596" },
    danger: { fg: "#A8201A", bg: "#FDE7E5", border: "#F5C2BE" },
    info: { fg: "#1D4F91", bg: "#E5EEFB", border: "#BCD1F2" },
    live: { fg: "#FFFFFF", bg: "#C8102E", border: "#C8102E" },
    unavailable: { fg: "#535D72", bg: "#EEF1F6", border: "#DBE0E8" },
  },
};
export type ThemeMode = "system" | "light" | "dark";

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

  background: "#0F172A",
  surface: "#172033",
  surfaceSecondary: "#111827",
  textStrong: "#F8FAFC",
  textMuted: "#A3AEC0",
  textInverse: "#0F172A",
  border: "#334155",
  divider: "#273449",
  actionPrimary: "#D0142C",
  actionPrimaryPressed: "#B0102A",
  onActionPrimary: "#FFFFFF",
  actionSecondary: "#172033",
  onActionSecondary: "#F8FAFC",
  actionDestructive: "#B42318",
  onActionDestructive: "#FFFFFF",
  disabledSurface: "#334155",
  disabledText: "#C5CEDB",
  selectedSurface: "#3A1520",
  focusRing: "#93C0FF",
  hero: "#0B0F1A",
  onHero: "#FFFFFF",
  onHeroMuted: "#A3AEC0",
  skeleton: "#1E293B",
  skeletonHighlight: "#273449",
  scrim: "rgba(0,0,0,0.6)",
  scanSurface: "#FFFFFF",
  tones: {
    neutral: { fg: "#CBD5E1", bg: "#1E293B", border: "#334155" },
    brand: { fg: "#FF9AA9", bg: "#3A0F18", border: "#6B1A2A" },
    success: { fg: "#6EE7A0", bg: "#0F2E1D", border: "#1F5135" },
    warning: { fg: "#FBBF5A", bg: "#33250A", border: "#5C4413" },
    danger: { fg: "#FCA5A5", bg: "#3B1414", border: "#6B2323" },
    info: { fg: "#93C0FF", bg: "#102440", border: "#1E3F6B" },
    live: { fg: "#FFFFFF", bg: "#D0142C", border: "#D0142C" },
    unavailable: { fg: "#A3AEC0", bg: "#1E293B", border: "#334155" },
  },
};

export function getThemeColors(mode: Exclude<ThemeMode, "system">): ThemeColors {
  return mode === "dark" ? darkColors : lightColors;
}
