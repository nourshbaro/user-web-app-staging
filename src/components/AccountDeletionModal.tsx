import { Button, Input, useResponsive, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { userFacingError } from "@/lib/userFacingError";
import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function AccountDeletionModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const responsive = useResponsive();
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.backdrop, { paddingTop: insets.top }]}
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            responsive.isTablet && styles.wide,
            {
              backgroundColor: theme.colors.panel,
              borderColor: theme.colors.line,
              maxHeight: "100%",
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{
              padding: 20,
              paddingBottom: Math.max(insets.bottom, 20),
              gap: 12,
            }}
          >
            <Text style={[styles.eyebrow, { color: theme.colors.danger }]}>
              Permanent action
            </Text>
            <Text style={[styles.title, { color: theme.colors.ink }]}>
              Delete account
            </Text>
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  wide: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 520,
    marginBottom: 28,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  title: { fontSize: 22, fontWeight: "900" },
});
