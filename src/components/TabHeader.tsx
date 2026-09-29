import { AppText } from "@/components/foundation";
import { HeaderActions } from "@/components/HeaderActions";
import { useI18n } from "@/i18n/I18nProvider";
import { size, spacing } from "@/lib/designTokens";
import type { ReactNode } from "react";
import { Image, View } from "react-native";

/**
 * Primary-tab header (v3): a large display title with an optional supporting
 * line, and the cart action. The status-bar inset is already applied by
 * `Screen`; this header draws no background of its own.
 */
export function TabHeader({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: ReactNode }) {
  return (
    <View style={local.row}>
      <View style={local.copy}>
        <AppText variant="displayTitle" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {title}
        </AppText>
        {subtitle ? <AppText variant="meta" tone="muted" numberOfLines={2}>{subtitle}</AppText> : null}
      </View>
      {trailing ?? <HeaderActions />}
    </View>
  );
}

/** Home's brand header: LFA mark, app name and the cart action. */
export function BrandHeader() {
  const { t } = useI18n();
  return (
    <View style={local.row}>
      <View style={local.brand}>
        <Image
          source={require("../../assets/images/lfa-logo.png")}
          style={local.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessible={false}
        />
        <View style={local.copy}>
          <AppText variant="cardTitle" accessibilityRole="header" numberOfLines={1}>{t("brand.appName")}</AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>{t("brand.federation")}</AppText>
        </View>
      </View>
      <HeaderActions />
    </View>
  );
}

const local = {
  row: {
    minHeight: size.touchTarget + spacing.sm,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  copy: { flex: 1, minWidth: 0 },
  brand: { flex: 1, minWidth: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  logo: { width: 40, height: 40 },
};
