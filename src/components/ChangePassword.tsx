import { BottomSheetModal, type BottomSheetModalHandle } from "@/components/BottomSheetModal";
import { Button, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/services/api";
import { SymbolView } from "expo-symbols";
import { forwardRef, useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function ChangePassword() {
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState({ current: false, password: false, confirmation: false });
  const submitting = useRef(false);
  const currentPasswordRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);
  const sheetRef = useRef<BottomSheetModalHandle>(null);
  const currentPasswordWrapRef = useRef<View>(null);
  const passwordWrapRef = useRef<View>(null);
  const confirmationWrapRef = useRef<View>(null);

  const close = (force = false) => {
    if (submitting.current && !force) return;
    setVisible(false);
    setCurrentPassword("");
    setPassword("");
    setConfirmation("");
    setError("");
    setRevealed({ current: false, password: false, confirmation: false });
  };

  const submit = async () => {
    if (submitting.current) return;
    if (!currentPassword) return setError("Enter your current password.");
    if (!password) return setError("Enter a new password.");
    if (!confirmation) return setError("Re-enter your new password.");
    if (confirmation !== password) return setError("Passwords do not match. Re-enter your new password.");

    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const successMessage = await auth.changePassword(currentPassword, password, confirmation);
      close(true);
      toast.showToast({
        variant: "success",
        title: "Password changed",
        message: successMessage || "Your password was updated successfully.",
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? backendErrorMessage(caught) : "Could not change your password. Please try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  // The modal's child content can mount before the native modal has
  // actually finished presenting, so `autoFocus` on the first field is
  // unreliable — focus once `onShow` fires instead (see BottomSheetModal's
  // `onPresented`), on the next frame so the sheet's own slide-in has a
  // layout pass to settle first.
  const focusInitialField = useCallback(() => {
    requestAnimationFrame(() => currentPasswordRef.current?.focus());
  }, []);

  // TextInput.focus() fires the same native `onFocus` event a user tap
  // would, so wiring these on each field's `onFocus` covers the initial
  // autofocus above, the Return-key focus chain below, and a direct tap —
  // with one mechanism instead of three.
  const revealCurrentPassword = useCallback(() => sheetRef.current?.scrollFieldIntoView(currentPasswordWrapRef), []);
  const revealPassword = useCallback(() => sheetRef.current?.scrollFieldIntoView(passwordWrapRef), []);
  const revealConfirmation = useCallback(() => sheetRef.current?.scrollFieldIntoView(confirmationWrapRef), []);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change Password"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.action, { borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, pressed && styles.pressed]}
      >
        <View style={[styles.actionIcon, { backgroundColor: theme.colors.panelSoft }]}>
          <SymbolView name={{ ios: "key", android: "key", web: "key" }} size={20} tintColor={theme.colors.primary} fallback={<View />} />
        </View>
        <Text style={[styles.actionText, { color: theme.colors.ink }]}>Change Password</Text>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={22} tintColor={theme.colors.muted} fallback={<View />} />
      </Pressable>

      <BottomSheetModal
        ref={sheetRef}
        visible={visible}
        onClose={() => close()}
        title="Change Password"
        closeLabel="Close change password"
        dismissible={!busy}
        wide
        scrollable
        keyboardAware
        contentContainerStyle={styles.modalContent}
        onPresented={focusInitialField}
      >
        <PasswordInput
          ref={currentPasswordRef}
          containerRef={currentPasswordWrapRef}
          label="Current Password"
          value={currentPassword}
          visible={revealed.current}
          editable={!busy}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          onFocus={revealCurrentPassword}
          onToggle={() => setRevealed((value) => ({ ...value, current: !value.current }))}
          onChangeText={(value) => { setCurrentPassword(value); setError(""); }}
        />
        <PasswordInput
          ref={passwordRef}
          containerRef={passwordWrapRef}
          label="New Password"
          value={password}
          visible={revealed.password}
          editable={!busy}
          returnKeyType="next"
          onSubmitEditing={() => confirmationRef.current?.focus()}
          onFocus={revealPassword}
          onToggle={() => setRevealed((value) => ({ ...value, password: !value.password }))}
          onChangeText={(value) => { setPassword(value); setError(""); }}
        />
        <PasswordInput
          ref={confirmationRef}
          containerRef={confirmationWrapRef}
          label="Confirm New Password"
          value={confirmation}
          visible={revealed.confirmation}
          editable={!busy}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          onFocus={revealConfirmation}
          onToggle={() => setRevealed((value) => ({ ...value, confirmation: !value.confirmation }))}
          onChangeText={(value) => { setConfirmation(value); setError(""); }}
        />
        {error ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger }}>{error}</Text> : null}
        <Button title={busy ? "Updating..." : "Update Password"} disabled={busy} onPress={() => void submit()} />
      </BottomSheetModal>
    </>
  );
}

type PasswordInputProps = {
  label: string;
  value: string;
  visible: boolean;
  editable: boolean;
  onToggle: () => void;
  onChangeText: (value: string) => void;
  /** Ref to the outer label+input wrapper — used for BottomSheetModal's `scrollFieldIntoView`, which needs the whole field group's position, not just the input's, so the label stays visible too. */
  containerRef?: RefObject<View | null>;
} & Pick<React.ComponentProps<typeof TextInput>, "returnKeyType" | "onSubmitEditing" | "onFocus">;

const PasswordInput = forwardRef<TextInput, PasswordInputProps>(function PasswordInput(
  { label, value, visible, editable, onToggle, onChangeText, containerRef, ...inputProps },
  ref,
) {
  const theme = useTheme();
  return (
    <View ref={containerRef} style={styles.inputWrap}>
      <Text style={theme.styles.label}>{label}</Text>
      <View style={[styles.passwordField, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
        <TextInput ref={ref} {...inputProps} accessibilityLabel={label} value={value} onChangeText={onChangeText} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} editable={editable} textContentType={label === "Current Password" ? "password" : "newPassword"} placeholderTextColor={theme.colors.muted} style={[styles.passwordInput, { color: theme.colors.ink }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${visible ? "Hide" : "Show"} ${label}`} disabled={!editable} onPress={onToggle} hitSlop={8} style={styles.visibilityButton}>
          <SymbolView name={{ ios: visible ? "eye.slash" : "eye", android: visible ? "visibility_off" : "visibility", web: visible ? "visibility_off" : "visibility" }} size={20} tintColor={theme.colors.muted} fallback={<View />} />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  action: { borderRadius: 18, borderWidth: 1, overflow: "hidden", minHeight: 68, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionText: { flex: 1, fontSize: 16, fontWeight: "800" },
  modalContent: { gap: 14, paddingTop: 16, paddingBottom: 8 },
  inputWrap: { gap: 6 },
  passwordField: { minHeight: 46, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, minHeight: 46, paddingLeft: 12, fontSize: 15 },
  visibilityButton: { width: 46, minHeight: 46, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
});

function backendErrorMessage(error: ApiError) {
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
  return error.message || `Request failed with ${error.status}`;
}
