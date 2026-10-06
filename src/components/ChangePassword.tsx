import { AccountFormShell } from "@/components/account/AccountFormShell";
import { PasswordField } from "@/components/account/PasswordField";
import { AppText } from "@/components/foundation";
import { Button } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { ApiError } from "@/services/api";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { TextInput } from "react-native";

/**
 * Change password (LFA Screen v3 `chpw`, a pushed screen). The one owner of
 * this flow: validates locally, then `AuthContext.changePassword` — the same
 * endpoint, payload and session behaviour as before (on success the session
 * is cleared and the user signs in again; `AuthContext` owns that). The v3
 * "Forgot your current password?" link is not offered: the recovery flow
 * lives in the signed-out `/auth` screen, which has no entry for a signed-in
 * user.
 */
export function ChangePassword() {
  const auth = useAuth();
  const toast = useToast();
  const i18n = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Synchronous: a second press (or Return) before the re-render never submits twice.
  const submitting = useRef(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);

  const back = () => {
    if (submitting.current) return;
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  };

  const submit = async () => {
    if (submitting.current) return;
    if (!currentPassword) return setError(i18n.t("changePassword.error.current"));
    if (!password) return setError(i18n.t("changePassword.error.new"));
    if (!confirmation) return setError(i18n.t("changePassword.error.confirm"));
    if (confirmation !== password) return setError(i18n.t("changePassword.error.mismatch"));

    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const successMessage = await auth.changePassword(currentPassword, password, confirmation);
      toast.showToast({
        variant: "success",
        title: i18n.t("changePassword.success.title"),
        message: successMessage || i18n.t("changePassword.success.message"),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? backendErrorMessage(caught, i18n.t("changePassword.error.generic")) : i18n.t("changePassword.error.generic"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const field = (label: string) => ({
    revealLabel: i18n.t("changePassword.show", { field: label }),
    concealLabel: i18n.t("changePassword.hide", { field: label }),
  });

  return (
    <AccountFormShell
      title={i18n.t("changePassword.title")}
      backLabel={i18n.t("profile.title")}
      onBack={back}
      backDisabled={busy}
      footer={
        <Button
          title={busy ? i18n.t("changePassword.submitting") : i18n.t("changePassword.submit")}
          disabled={busy}
          loading={busy}
          onPress={() => void submit()}
        />
      }
    >
      <PasswordField
        label={i18n.t("changePassword.current")}
        value={currentPassword}
        editable={!busy}
        contentType="password"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        onChangeText={(value) => { setCurrentPassword(value); setError(""); }}
        {...field(i18n.t("changePassword.current"))}
      />
      <PasswordField
        ref={passwordRef}
        label={i18n.t("changePassword.new")}
        value={password}
        editable={!busy}
        contentType="newPassword"
        placeholder={i18n.t("changePassword.newPlaceholder")}
        returnKeyType="next"
        onSubmitEditing={() => confirmationRef.current?.focus()}
        onChangeText={(value) => { setPassword(value); setError(""); }}
        {...field(i18n.t("changePassword.new"))}
      />
      <PasswordField
        ref={confirmationRef}
        label={i18n.t("changePassword.confirm")}
        value={confirmation}
        editable={!busy}
        contentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        onChangeText={(value) => { setConfirmation(value); setError(""); }}
        {...field(i18n.t("changePassword.confirm"))}
      />
      <AppText variant="meta" tone="muted" style={local.hint}>{i18n.t("changePassword.hint")}</AppText>
      {error ? (
        <AppText variant="meta" tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite" style={local.hint}>
          {error}
        </AppText>
      ) : null}
    </AccountFormShell>
  );
}

const local = {
  // v3: 13/1.4 muted, padding 0 4.
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
};

function backendErrorMessage(error: ApiError, fallback: string) {
  const message = error.body?.message;
  if (typeof message === "string" && message.trim()) return message;
  const validationErrors = error.body?.errors;
  if (validationErrors && typeof validationErrors === "object") {
    for (const value of Object.values(validationErrors)) {
      if (typeof value === "string" && value.trim()) return value;
      if (Array.isArray(value)) {
        const first = value.find((item): item is string => typeof item === "string" && Boolean(item.trim()));
        if (first) return first;
      }
    }
  }
  const backendError = error.body?.error;
  if (typeof backendError === "string" && backendError.trim()) return backendError;
  // Never the transport text ("Request failed with 500").
  return fallback;
}
