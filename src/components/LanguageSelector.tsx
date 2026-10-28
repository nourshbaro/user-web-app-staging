import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { ENABLED_LOCALES, localeMeta } from "@/i18n/locales";
import { reloadAppAsync } from "expo";
import { Pressable, View } from "react-native";

/** Shared by Settings and the signed-out Profile, independent of authentication. */
export function LanguageSelector() {
  const i18n = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const failed = () => toast.showToast({
    variant: "error", title: i18n.t("settings.language.failed"), message: i18n.t("state.error.message"),
  });
  return (
    <View style={{ gap: 12 }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={i18n.t("settings.language")} style={{ flexDirection: "row", gap: 8 }}>
        {ENABLED_LOCALES.map((locale) => (
          <Pressable
            key={locale}
            accessibilityRole="radio"
            accessibilityLabel={localeMeta(locale).nativeName}
            aria-checked={locale === i18n.locale}
            aria-disabled={i18n.changingLanguage}
            disabled={i18n.changingLanguage}
            onPress={() => void i18n.setLanguage(locale).catch(failed)}
            style={({ pressed }) => ({
              flex: 1, minHeight: 48, padding: 12, borderRadius: 12, borderWidth: 1,
              borderColor: locale === i18n.locale ? theme.colors.actionPrimary : theme.colors.border,
              backgroundColor: theme.colors.surface, opacity: pressed || i18n.changingLanguage ? 0.7 : 1,
              alignItems: "center", justifyContent: "center",
            })}
          >
            <AppText style={{ fontFamily: undefined, fontWeight: locale === i18n.locale ? "700" : "400" }}>{localeMeta(locale).nativeName}</AppText>
          </Pressable>
        ))}
      </View>
      {i18n.restartRequired ? (
        <>
          <AppText variant="meta" tone="muted">{i18n.t("settings.language.restart")}</AppText>
          <Button title={i18n.t("direction.restart.action")} variant="secondary" onPress={() => {
            void reloadAppAsync("Apply selected language direction").catch(failed);
          }} />
        </>
      ) : null}
    </View>
  );
}
