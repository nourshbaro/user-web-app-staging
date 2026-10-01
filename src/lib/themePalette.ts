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

  // Match-day roles (LFA Screen v3).
  /** Raised element on a hero/night surface (e.g. the reservation pill). */
  heroRaised: string;
  /** Hairline on a hero/night surface. */
  heroHairline: string;
  /** Countdown emphasis on a hero surface once the reservation is running low. */
  onHeroUrgent: string;
  /** First-run brand surface (v3 splash radial gradient: glow → surface → deep). */
  brandSurface: string;
  brandGlow: string;
  brandDeep: string;
  onBrandSurface: string;
  /** Track behind segmented controls / unselected chips on the canvas. */
  segment: string;
  /** Hairline separating rows inside one grouped card. */
  hairline: string;
  /** Soft elevation colour for grouped cards and heroes. */
  shadow: string;
  /** v3 `--shadow`: resting cards and grouped lists (a CSS box-shadow list). */
  shadowCard: string;
  /** v3 `--shadow2`: heroes and raised surfaces. */
  shadowRaised: string;
  /** v3 `--crest`: plate behind team marks without a logo. */
  crest: string;
  /** v3 `--redInk`: brand-coloured text and text actions ("See all", "Clear"). */
  brandInk: string;
  /** v3 timeline yellow-card mark (#F2C230): a referee card colour, the same in both modes. */
  eventYellowCard: string;
  /** v3 timeline red-card mark (v3 `--red`). */
  eventRedCard: string;
  /** v3 `--bar`: translucent iOS tab bar. */
  bar: string;
  tones: Record<StatusTone, ToneColors>;
};

/**
 * LFA Screen v3 palette (`lfa3.css`). Values are v3's, with one documented
 * accessibility adjustment: light `textMuted` is v3 `--muted` (#6F7280)
 * darkened 3% (#6C6F7C) so secondary text meets WCAG AA (4.5:1) on v3's own
 * background (#6F7280 measures 4.3:1 there). Legacy roles map onto the same
 * v3 surfaces so not-yet-redesigned screens share one visual system.
 */
export const lightColors: ThemeColors = {
  bg: "#F4F4F6",
  bgAlt: "#E9E9EE",
  panel: "#FFFFFF",
  panelSoft: "#F7F7F9",
  ink: "#15161C",
  muted: "#6F7280",
  secondary: "#3B3D47",
  line: "#DEDEE1",
  primary: "#C8102E",
  primaryLight: "#E8112D",
  primaryDark: "#A30C25",
  green: "#0F7A45",
  gold: "#C8A84B",
  danger: "#B42318",
  success: "#0F7A45",

  background: "#F4F4F6",
  surface: "#FFFFFF",
  surfaceSecondary: "#F7F7F9",
  textStrong: "#15161C",
  textMuted: "#6C6F7C",
  textInverse: "#FFFFFF",
  border: "#DEDEE1",
  divider: "#EDEDEF",
  actionPrimary: "#C8102E",
  actionPrimaryPressed: "#A30C25",
  onActionPrimary: "#FFFFFF",
  actionSecondary: "#FFFFFF",
  onActionSecondary: "#15161C",
  actionDestructive: "#B42318",
  onActionDestructive: "#FFFFFF",
  disabledSurface: "#E9E9EE",
  disabledText: "#55586A",
  selectedSurface: "#FAEBED",
  focusRing: "#1D4F91",
  hero: "#14151B",
  onHero: "#FFFFFF",
  onHeroMuted: "#AAAAAC",
  skeleton: "#E9E9EE",
  skeletonHighlight: "#F4F4F6",
  scrim: "rgba(0,0,0,0.4)",
  scanSurface: "#FFFFFF",
  heroRaised: "#1E1F27",
  heroHairline: "rgba(255,255,255,0.1)",
  onHeroUrgent: "#FF8A9A",
  brandSurface: "#A80C24",
  brandGlow: "#D0142F",
  brandDeep: "#8E0A1F",
  onBrandSurface: "#FFFFFF",
  segment: "rgba(118,118,128,0.12)",
  hairline: "rgba(21,22,28,0.07)",
  shadow: "rgba(21,22,28,0.08)",
  shadowCard: "0px 1px 2px rgba(21,22,28,0.04), 0px 6px 20px rgba(21,22,28,0.06)",
  shadowRaised: "0px 18px 40px rgba(21,22,28,0.18), 0px 3px 8px rgba(21,22,28,0.08)",
  crest: "#EFEFF3",
  brandInk: "#B00E29",
  eventYellowCard: "#F2C230",
  eventRedCard: "#C8102E",
  bar: "rgba(247,247,249,0.88)",
  tones: {
    neutral: { fg: "#3B3D47", bg: "#E9E9EE", border: "#DEDEE1" },
    brand: { fg: "#B00E29", bg: "#FAEBED", border: "#F2C4CC" },
    success: { fg: "#0F7A45", bg: "#E7F2EC", border: "#BFE0CD" },
    warning: { fg: "#7A4A00", bg: "#FFF2D6", border: "#F4D596" },
    danger: { fg: "#A8201A", bg: "#FDE7E5", border: "#F5C2BE" },
    info: { fg: "#1D4F91", bg: "#E5EEFB", border: "#BCD1F2" },
    live: { fg: "#FFFFFF", bg: "#C8102E", border: "#C8102E" },
    unavailable: { fg: "#55586A", bg: "#E9E9EE", border: "#DEDEE1" },
  },
};
export type ThemeMode = "system" | "light" | "dark";

export const darkColors: ThemeColors = {
  bg: "#0B0B0E",
  bgAlt: "#1A1A20",
  panel: "#16161B",
  panelSoft: "#1D1D23",
  ink: "#F3F3F6",
  muted: "#8D8F9B",
  secondary: "#D2D3DA",
  line: "#2B2B32",
  primary: "#E8112D",
  primaryLight: "#FF3B55",
  primaryDark: "#C8102E",
  green: "#3FCB85",
  gold: "#F5C518",
  danger: "#EF4444",
  success: "#3FCB85",

  background: "#0B0B0E",
  surface: "#16161B",
  surfaceSecondary: "#1D1D23",
  textStrong: "#F3F3F6",
  textMuted: "#8D8F9B",
  textInverse: "#0B0B0E",
  border: "#2B2B32",
  divider: "#1F1F25",
  actionPrimary: "#E8112D",
  actionPrimaryPressed: "#C8102E",
  onActionPrimary: "#FFFFFF",
  actionSecondary: "#16161B",
  onActionSecondary: "#F3F3F6",
  actionDestructive: "#B42318",
  onActionDestructive: "#FFFFFF",
  disabledSurface: "#2B2B32",
  disabledText: "#C5C6CE",
  selectedSurface: "#361520",
  focusRing: "#93C0FF",
  hero: "#17171D",
  onHero: "#FFFFFF",
  onHeroMuted: "#ACACAE",
  skeleton: "#1D1D23",
  skeletonHighlight: "#26262D",
  scrim: "rgba(0,0,0,0.6)",
  scanSurface: "#FFFFFF",
  heroRaised: "#202028",
  heroHairline: "rgba(255,255,255,0.1)",
  onHeroUrgent: "#FF8A9A",
  brandSurface: "#A80C24",
  brandGlow: "#D0142F",
  brandDeep: "#8E0A1F",
  onBrandSurface: "#FFFFFF",
  segment: "rgba(118,118,128,0.24)",
  hairline: "rgba(255,255,255,0.07)",
  shadow: "rgba(0,0,0,0.35)",
  shadowCard: "0px 0px 0px 1px rgba(255,255,255,0.04), 0px 6px 20px rgba(0,0,0,0.35)",
  shadowRaised: "0px 0px 0px 1px rgba(255,255,255,0.05), 0px 20px 44px rgba(0,0,0,0.55)",
  crest: "#23232A",
  brandInk: "#FF6679",
  eventYellowCard: "#F2C230",
  eventRedCard: "#E8112D",
  bar: "rgba(16,16,20,0.88)",
  tones: {
    neutral: { fg: "#D2D3DA", bg: "#1D1D23", border: "#2B2B32" },
    brand: { fg: "#FF6679", bg: "#361520", border: "#5A1A28" },
    success: { fg: "#3FCB85", bg: "#122A1F", border: "#1F4A34" },
    warning: { fg: "#FBBF5A", bg: "#2E2410", border: "#5C4413" },
    danger: { fg: "#FCA5A5", bg: "#3A1414", border: "#6B2323" },
    info: { fg: "#93C0FF", bg: "#102440", border: "#1E3F6B" },
    live: { fg: "#FFFFFF", bg: "#E8112D", border: "#E8112D" },
    unavailable: { fg: "#8D8F9B", bg: "#1D1D23", border: "#2B2B32" },
  },
};

export function getThemeColors(mode: Exclude<ThemeMode, "system">): ThemeColors {
  return mode === "dark" ? darkColors : lightColors;
}
