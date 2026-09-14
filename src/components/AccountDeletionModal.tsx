import { Button, Input, useTheme } from "@/components/ui";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { userFacingError } from "@/lib/userFacingError";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text } from "react-native";

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
  return (
    <BottomSheetModal
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
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ gap: 12 }}>
          <Text style={theme.styles.muted}>
            Your account and associated data will be permanently removed.
            Enter your password to continue.
          </Text>
          <Input
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
          />
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
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheetModal>
  );
}
