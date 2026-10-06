/**
 * RTL conventions (pure module).
 *
 * - Layout: use flex rows and logical props (`marginStart`, `paddingEnd`,
 *   `start`/`end`) in new components; React Native mirrors rows and logical
 *   edges when the native layout direction is RTL.
 * - Text: use `textAlign: "auto"` (natural) or `"center"`. Do not hand-flip
 *   `left`/`right`; place end-aligned text with layout (`alignSelf`) instead.
 * - Icons: only directional glyphs mirror (chevrons, back/forward arrows);
 *   use `directionalChevron`. Logos, play icons, checkmarks never mirror.
 * - Physical layouts NEVER mirror: stadium maps, seat maps/grids and QR codes
 *   represent real-world geometry. Wrap them in `PHYSICAL_LAYOUT_STYLE`
 *   (or `<PhysicalLayout>`) so RTL cannot reorder or flip them.
 */

export type SymbolName = { ios: string; android: string; web: string };

const CHEVRON_RIGHT: SymbolName = { ios: "chevron.right", android: "chevron_right", web: "chevron_right" };
const CHEVRON_LEFT: SymbolName = { ios: "chevron.left", android: "chevron_left", web: "chevron_left" };

const ARROW_LEFT: SymbolName = { ios: "arrow.left", android: "arrow_back", web: "arrow_back" };
const ARROW_RIGHT: SymbolName = { ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" };

/**
 * The navigation back glyph (LFA Screen v3 `I.back`): a chevron on iOS (and
 * web), the Material arrow on Android. Points toward the reading start, so it
 * mirrors in RTL.
 */
export function navigationBackGlyph(platform: "ios" | "android", isRTL: boolean): SymbolName {
  if (platform === "android") return isRTL ? ARROW_RIGHT : ARROW_LEFT;
  return isRTL ? CHEVRON_RIGHT : CHEVRON_LEFT;
}

/** "forward" points toward the reading direction's end; "back" toward its start. */
export function directionalChevron(kind: "forward" | "back", isRTL: boolean): SymbolName {
  const pointsRight = (kind === "forward") !== isRTL;
  return pointsRight ? CHEVRON_RIGHT : CHEVRON_LEFT;
}

export const PHYSICAL_LAYOUT_STYLE = { direction: "ltr" } as const;
