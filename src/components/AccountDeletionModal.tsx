import { Button, Input, useTheme } from "@/components/ui";
import { BottomSheetModal, type BottomSheetModalHandle } from "@/components/BottomSheetModal";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { userFacingError } from "@/lib/userFacingError";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

export function AccountDeletionModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const sheetRef = useRef<BottomSheetModalHandle>(null);
  // Groups the instruction copy with the password field so both stay
  // visible together when the field is brought into view — the field's own
  // "Password" label alone isn't enough context here per the real-device
  // report; the leading instruction line is the actual first "label" a user
  // reads before the input.
  const firstFieldGroupRef = useRef<View>(null);
  const close = () => {
    if (submitting) return;
    setPassword("");
    setError(null);
    onClose();
  };
  const remove = async () => {
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.deleteAccount(password);
      toast.showToast({
        variant: "success",
        title: "Account deleted",
        message: "Your account has been permanently deleted.",
      });
      onClose();
      router.replace("/");
    } catch (err) {
      setError(
        userFacingError(
          err,
          "Could not delete your account. Check your password and try again.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };
  // The modal's child content can mount before the native modal has
  // actually finished presenting, so `autoFocus` is unreliable here — focus
  // once `onShow` fires instead (see BottomSheetModal's `onPresented`), on
  // the next frame so the sheet's own slide-in has a layout pass to settle
  // first, which is also what lets the keyboard open immediately and the
  // field stay visible above it.
  const focusPasswordField = useCallback(() => {
    requestAnimationFrame(() => passwordInputRef.current?.focus());
  }, []);
  // TextInput.focus() fires the same native `onFocus` event a user tap
  // would, so this one handler covers the initial autofocus above as well
  // as the user tapping back into the field later.
  const revealFirstField = useCallback(() => {
    sheetRef.current?.scrollFieldIntoView(firstFieldGroupRef);
  }, []);
  return (
    <BottomSheetModal
      ref={sheetRef}
      visible={visible}
      onClose={close}
      title="Delete account"
      subtitle="Permanent action"
      // A deletion request in flight must not be dismissible mid-flight —
      // dismissing while the API call is pending would leave the user
      // unsure whether their account was deleted. The X/backdrop/swipe
      // dismiss affordances re-enable automatically once `submitting`
      // clears (success or failure).
      dismissible={!submitting}
      scrollable
      keyboardAware
      contentContainerStyle={local.content}
      onPresented={focusPasswordField}
    >
      <View ref={firstFieldGroupRef} style={local.firstFieldGroup}>
        <Text style={theme.styles.muted}>
          Your account and associated data will be permanently removed.
          Enter your password to continue.
        </Text>
        <Input
          ref={passwordInputRef}
          label="Password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setError(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
          onFocus={revealFirstField}
        />
      </View>
      {error ? (
        <Text style={{ color: theme.colors.danger }}>{error}</Text>
      ) : null}
      <Button
        title={submitting ? "Deleting..." : "Delete permanently"}
        variant="danger"
        disabled={!password || submitting}
        onPress={() => void remove()}
      />
      <Button
        title="Keep my account"
        variant="secondary"
        disabled={submitting}
        onPress={close}
      />
    </BottomSheetModal>
  );
}

const local = { content: { gap: 12 }, firstFieldGroup: { gap: 8 } };
