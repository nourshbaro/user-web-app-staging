import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { lineHeightForScript, typography, type TypographyToken, type TypographyVariant } from "@/lib/designTokens";
import { fontStyleFor } from "@/lib/fontFamilies";
import type { ThemeColors } from "@/lib/themePalette";
import type { Ref } from "react";
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
  /** React 19 passes refs as props (e.g. to move screen-reader focus to a title). */
  ref?: Ref<Text>;
  variant?: TypographyVariant;
  tone?: TextTone;
  /**
   * "start" is natural alignment (follows the writing direction). There is
   * deliberately no "end": place end-aligned text with layout instead.
   */
  align?: "start" | "center";
};

/** Typography primitive: semantic variant + tone, script-aware family and line height. */
export function AppText({ variant = "body", tone = "strong", align = "start", style, ...props }: Props) {
  const theme = useTheme();
  const { meta } = useI18n();
  const token: TypographyToken = typography[variant];
  return (
    <Text
      {...props}
      style={[
        {
          fontSize: token.fontSize,
          lineHeight: lineHeightForScript(token, meta.script),
          ...fontStyleFor(token.family ?? "text", token.fontWeight, meta.script),
          fontVariant: token.fontVariant ? [...token.fontVariant] : undefined,
          color: toneColor(theme.colors, tone),
          textAlign: align === "center" ? "center" : "auto",
          // Uppercase display titles are Latin-only: Arabic script has no case.
          textTransform: token.uppercase && meta.script === "latin" ? "uppercase" : undefined,
        },
        style,
      ]}
    />
  );
}
