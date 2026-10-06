import { AccountFormShell } from "@/components/account/AccountFormShell";
import { PasswordField } from "@/components/account/PasswordField";
import { AppText } from "@/components/foundation";
import { Button, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { userFacingError } from "@/lib/userFacingError";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useRef, useState } from "react";
import { View } from "react-native";

/**
 * Delete account, step 2 (LFA Screen v3 `delete_verify`), reached only from
 * the Settings confirmation dialog (step 1, `settings_delete`). The backend
 * requires the current password (`DELETE /auth/account { password }`), which
 * is exactly what this step collects; `AuthContext.deleteAccount` owns the
 * request and the session cleanup. Nothing is sent without a password, a
 * second press never sends twice, and the screen cannot be left while the
 * request is in flight. The v3 "Forgot password?" link is not offered (the
 * recovery flow is signed-out only).
 */
export function DeleteAccount() {
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const i18n = useI18n();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const back = () => {
    if (inFlight.current) return;
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const remove = async () => {
    if (!password || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await auth.deleteAccount(password);
      toast.showToast({
        variant: "success",
        title: i18n.t("deleteAccount.success.title"),
        message: i18n.t("deleteAccount.success.message"),
      });
      router.replace("/");
    } catch (err) {
      setError(userFacingError(err, i18n.t("deleteAccount.error.generic")));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AccountFormShell
      title=""
      backLabel={i18n.t("settings.title")}
      onBack={back}
      backDisabled={submitting}
      footer={
        <>
          <Button
            title={submitting ? i18n.t("deleteAccount.submitting") : i18n.t("deleteAccount.submit")}
            variant="danger"
            disabled={!password || submitting}
            loading={submitting}
            onPress={() => void remove()}
          />
          <Button title={i18n.t("deleteAccount.cancel")} variant="ghost" disabled={submitting} onPress={back} />
        </>
      }
    >
      <View style={[local.tile, { backgroundColor: theme.colors.tones.brand.bg }]} accessible={false}>
        <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={30} tintColor={theme.colors.actionPrimary} fallback={<View />} />
      </View>
      <AppText variant="displayPrompt" accessibilityRole="header" style={local.title}>{i18n.t("deleteAccount.title")}</AppText>
      <AppText variant="body" tone="muted" style={local.message}>{i18n.t("deleteAccount.message")}</AppText>
      <View style={local.field}>
        <PasswordField
          label={i18n.t("deleteAccount.password")}
          value={password}
          placeholder={i18n.t("deleteAccount.passwordPlaceholder")}
          editable={!submitting}
          contentType="password"
          returnKeyType="done"
          revealLabel={i18n.t("changePassword.show", { field: i18n.t("deleteAccount.password") })}
          concealLabel={i18n.t("changePassword.hide", { field: i18n.t("deleteAccount.password") })}
          onChangeText={(value) => {
            setPassword(value);
            setError(null);
          }}
        />
      </View>
      {error ? (
        <AppText variant="meta" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </AccountFormShell>
  );
}

// LFA Screen v3 delete_verify: 64pt tile radius 18 (red soft, 30pt lock); title
// margin-top 8, Barlow 700 34/1.02 uppercase; body 15/1.45 muted; field margin-top 8.
const local = {
  tile: { width: 64, height: 64, borderRadius: 18, alignItems: "center" as const, justifyContent: "center" as const },
  title: { marginTop: 8 },
  message: { fontSize: 15, lineHeight: 22 },
  field: { marginTop: 8 },
};
