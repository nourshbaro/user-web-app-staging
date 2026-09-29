/**
 * Font families behind the semantic typography tokens. Pure module (no React
 * Native imports) so it stays unit-testable under `node --test`.
 *
 * Two roles:
 * - `text`    — IBM Plex Sans: all normal UI and body typography.
 * - `display` — Barlow Condensed: selective sports/display data only
 *               (kickoff times, countdown emphasis, display titles, codes).
 *
 * Families are chosen per script. Neither Latin family is an Arabic font, so
 * Arabic resolves to `null` (the platform font) for both roles until an
 * Arabic-capable family is chosen; Barlow Condensed never becomes the Arabic
 * dependency. Screens never name a family: they pick a typography variant.
 */

export type FontRole = "text" | "display";
export type FontScript = "latin" | "arabic";
export type FontWeight = "400" | "500" | "600" | "700" | "800" | "900";

/** Loaded family names, keyed by the weight they render (see `useAppFonts`). */
export const LATIN_FONT_FAMILIES = {
  text: {
    "400": "IBMPlexSans_400Regular",
    "500": "IBMPlexSans_500Medium",
    "600": "IBMPlexSans_600SemiBold",
    "700": "IBMPlexSans_700Bold",
  },
  display: {
    "500": "BarlowCondensed_500Medium",
    "600": "BarlowCondensed_600SemiBold",
    "700": "BarlowCondensed_700Bold",
  },
} as const;

type RoleWeights = Record<string, string>;

/** Nearest loaded weight at or below the request (heavier requests clamp to the heaviest file). */
function nearestWeight(weights: RoleWeights, requested: FontWeight) {
  const available = Object.keys(weights).map(Number).sort((a, b) => a - b);
  const target = Number(requested);
  let chosen = available[0];
  for (const weight of available) {
    if (weight <= target) chosen = weight;
  }
  return weights[String(chosen)];
}

/**
 * Whether the custom font files are registered. Set once by `useAppFonts`
 * before the app renders; it stays false if loading failed, so text falls back
 * to the platform font instead of naming an unregistered family.
 */
let customFontsLoaded = false;

export function setCustomFontsLoaded(loaded: boolean) {
  customFontsLoaded = loaded;
}

/** The family for a role/weight/script, or `null` for the platform font. */
export function fontFamilyFor(role: FontRole, weight: FontWeight, script: FontScript, fontsLoaded = customFontsLoaded): string | null {
  if (!fontsLoaded || script !== "latin") return null;
  return nearestWeight(LATIN_FONT_FAMILIES[role], weight);
}

/**
 * Style fragment for a resolved font. A custom family carries its own weight,
 * so `fontWeight` is omitted (Android would otherwise synthesise bold or fall
 * back); the platform font keeps the requested weight.
 */
export function fontStyleFor(role: FontRole, weight: FontWeight, script: FontScript, fontsLoaded = customFontsLoaded) {
  const fontFamily = fontFamilyFor(role, weight, script, fontsLoaded);
  return fontFamily ? { fontFamily } : { fontWeight: weight };
}
