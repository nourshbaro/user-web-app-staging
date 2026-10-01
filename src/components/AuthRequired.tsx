import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { getSafeAuthReturnRoute } from "@/lib/authReturnRoute";
import { router, usePathname } from "expo-router";
import { Image, View } from "react-native";

/**
 * Signed-out card (v3 sign-in language: LFA mark, display title, one action).
 * It only opens the existing `/auth` screen, returning to this route through
 * the validated return route; it creates no session and holds no data.
 */
export function AuthRequired() {
  const theme = useTheme();
  const i18n = useI18n();
  const pathname = usePathname();
  const returnTo = getSafeAuthReturnRoute(pathname) ?? "/";
  return (
    <View style={local.container}>
      <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
        <Image
          source={require("../../assets/images/lfa-logo.png")}
          style={local.logo}
          resizeMode="contain"
          accessible={false}
        />
        <AppText variant="displayNumeral" align="center" accessibilityRole="header" style={local.title}>
          {i18n.t("auth.required.title")}
        </AppText>
        <AppText variant="body" tone="muted" align="center" style={local.detail}>
          {i18n.t("auth.required.message")}
        </AppText>
        <View style={local.action}>
          <Button
            title={i18n.t("auth.required.action")}
            onPress={() =>
              router.push({ pathname: "/auth", params: { returnTo } })
            }
          />
        </View>
      </View>
    </View>
  );
}

const local = {
  container: { width: "100%" as const, alignItems: "center" as const, paddingVertical: 16 },
  card: {
    width: "100%" as const,
    maxWidth: 480,
    borderRadius: 20,
    padding: 22,
    alignItems: "center" as const,
    gap: 8,
  },
  logo: { width: 64, height: 64, marginBottom: 6 },
  title: { textTransform: "uppercase" as const },
  detail: { maxWidth: 320 },
  action: { alignSelf: "stretch" as const, marginTop: 10 },
};
