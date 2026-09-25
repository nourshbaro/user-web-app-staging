/**
 * Non-color design tokens. Colors live in `themePalette.ts` (theme-dependent);
 * everything here is theme-independent. Pure module: no React Native imports,
 * so it stays unit-testable under `node --test`.
 */

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const size = {
  /** Preferred minimum interactive size (Material 48dp). */
  touchTarget: 48,
  /** Absolute minimum interactive size (Apple HIG 44pt); use hitSlop to reach it. */
  touchTargetMin: 44,
  controlHeight: 48,
  controlHeightCompact: 40,
  badgeHeight: 24,
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  transactionBarMinHeight: 64,
} as const;

/** Breakpoints mirror `useResponsive()` in `src/components/ui.tsx`. */
export const breakpoints = {
  narrow: 390,
  tablet: 768,
  desktop: 1024,
} as const;

export const layout = {
  gutterNarrow: 12,
  gutter: 16,
  gutterTablet: 24,
  sectionGap: 20,
  cardPadding: 16,
  cardGap: 12,
  maxContentWidth: 1180,
  /** Comfortable single-column width for forms, dialogs and state panels. */
  readableWidth: 560,
} as const;

export function pageGutter(width: number) {
  if (width >= breakpoints.tablet) return layout.gutterTablet;
  if (width < breakpoints.narrow) return layout.gutterNarrow;
  return layout.gutter;
}

type FontWeight = "400" | "500" | "600" | "700" | "800" | "900";

export type TypographyToken = {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  /** Tabular digits keep prices, totals and timers from jittering. */
  fontVariant?: "tabular-nums"[];
};

/**
 * System fonts only (no decorative custom font). Letter-spacing is always 0:
 * tracking breaks Arabic letter joining, so no variant may depend on it.
 * Line heights leave room for Arabic ascenders/descenders (see
 * `lineHeightForScript`).
 */
export const typography = {
  hero: { fontSize: 28, lineHeight: 34, fontWeight: "900" },
  screenTitle: { fontSize: 24, lineHeight: 30, fontWeight: "800" },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "800" },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  meta: { fontSize: 13, lineHeight: 19, fontWeight: "500" },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: "500" },
  action: { fontSize: 16, lineHeight: 21, fontWeight: "700" },
  numeric: { fontSize: 18, lineHeight: 24, fontWeight: "800", fontVariant: ["tabular-nums"] },
  numericLarge: { fontSize: 26, lineHeight: 32, fontWeight: "900", fontVariant: ["tabular-nums"] },
} as const satisfies Record<string, TypographyToken>;

export type TypographyVariant = keyof typeof typography;

/** Arabic script needs extra vertical room; Latin uses the token as-is. */
export const ARABIC_LINE_HEIGHT_SCALE = 1.15;

export function lineHeightForScript(token: TypographyToken, script: "latin" | "arabic") {
  return script === "arabic" ? Math.ceil(token.lineHeight * ARABIC_LINE_HEIGHT_SCALE) : token.lineHeight;
}
