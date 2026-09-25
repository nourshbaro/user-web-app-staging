import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { lineHeightForScript, typography, type TypographyVariant } from "@/lib/designTokens";
import type { ThemeColors } from "@/lib/themePalette";
import { Text, type TextProps } from "react-native";

export type TextTone = "strong" | "muted" | "inverse" | "onHero" | "onHeroMuted" | "brand" | "danger";

function toneColor(colors: ThemeColors, tone: TextTone) {
  switch (tone) {
    case "muted": return colors.textMuted;
    case "inverse": return colors.textInverse;
    case "onHero": return colors.onHero;
    case "onHeroMuted": return colors.onHeroMuted;
    case "brand": return colors.tones.brand.fg;
    case "danger": return colors.tones.danger.fg;
    default: return colors.textStrong;
  }
}

type Props = TextProps & {
  variant?: TypographyVariant;
  tone?: TextTone;
  /**
   * "start" is natural alignment (follows the writing direction). There is
   * deliberately no "end": place end-aligned text with layout instead.
   */
  align?: "start" | "center";
};

/** Typography primitive: semantic variant + tone, script-aware line height. */
export function AppText({ variant = "body", tone = "strong", align = "start", style, ...props }: Props) {
  const theme = useTheme();
  const { meta } = useI18n();
  const token = typography[variant];
  return (
    <Text
      {...props}
      style={[
        {
          fontSize: token.fontSize,
          lineHeight: lineHeightForScript(token, meta.script),
          fontWeight: token.fontWeight,
          fontVariant: "fontVariant" in token ? [...token.fontVariant] : undefined,
          color: toneColor(theme.colors, tone),
          textAlign: align === "center" ? "center" : "auto",
        },
        style,
      ]}
    />
  );
}
