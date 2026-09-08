import { Button, Input, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/services/api";
import { SymbolView } from "expo-symbols";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Step = "closed" | "current" | "new";

export function ChangePassword() {
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const [step, setStep] = useState<Step>("closed");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const close = (force = false) => {
    if (submitting.current && !force) return;
    setStep("closed");
    setCurrentPassword("");
    setPassword("");
    setConfirmation("");
    setError("");
  };

  const continueFromCurrent = () => {
    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    setError("");
    setStep("new");
  };

  const submit = async () => {
    if (submitting.current) return;
    if (!password) {
      setError("Enter a new password.");
      return;
    }
    if (!confirmation) {
      setError("Re-enter your new password.");
      return;
    }
    if (confirmation !== password) {
      setError("Passwords do not match. Re-enter your new password.");
      return;
    }

    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await auth.changePassword(currentPassword, password, confirmation);
      close(true);
      toast.showToast({
        variant: "success",
        title: "Password changed",
        message: "Your password was updated successfully.",
      });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(backendErrorMessage(caught));
      } else {
        setError("Could not change your password. Please try again.");
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (step === "closed") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Change Password"
        onPress={() => setStep("current")}
        style={({ pressed }) => [
          styles.action,
          {
            borderColor: theme.colors.line,
            backgroundColor: theme.colors.panel,
          },
          pressed && styles.pressed,
        ]}
      >
        <View
          style={[
            styles.actionIcon,
            { backgroundColor: theme.colors.panelSoft },
          ]}
        >
          <SymbolView
            name={{ ios: "key", android: "key", web: "key" }}
            size={20}
            tintColor={theme.colors.primary}
            fallback={<Text style={{ color: theme.colors.primary }}>K</Text>}
          />
        </View>
        <Text style={[styles.actionText, { color: theme.colors.ink }]}>
          Change Password
        </Text>
        <Text style={[styles.chevron, { color: theme.colors.muted }]}>›</Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.flow,
        { backgroundColor: theme.colors.panel, borderColor: theme.colors.line },
      ]}
    >
      <View style={styles.flowHeader}>
        <View>
          <Text style={[styles.title, { color: theme.colors.ink }]}>
            Change Password
          </Text>
          <Text style={theme.styles.muted}>
            {step === "current" ? "Step 1 of 2" : "Step 2 of 2"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close change password"
          hitSlop={8}
          disabled={busy}
          onPress={() => close()}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Text style={[styles.closeText, { color: theme.colors.ink }]}>×</Text>
        </Pressable>
      </View>

      {step === "current" ? (
        <Input
          label="Current Password"
          value={currentPassword}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          textContentType="password"
          returnKeyType="next"
          onSubmitEditing={continueFromCurrent}
          onChangeText={(value) => {
            setCurrentPassword(value);
            setError("");
          }}
        />
      ) : (
        <View style={styles.fields}>
          <Input
            label="New Password"
            value={password}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            textContentType="newPassword"
            returnKeyType="next"
            onChangeText={(value) => {
              setPassword(value);
              setError("");
            }}
          />
          <Input
            label="Re-enter New Password"
            value={confirmation}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            onChangeText={(value) => {
              setConfirmation(value);
              setError("");
            }}
          />
        </View>
      )}

      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.colors.danger }}
        >
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {step === "new" ? (
          <View style={styles.actionButton}>
            <Button
              title="Back"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                setStep("current");
                setError("");
              }}
            />
          </View>
        ) : (
          <View style={styles.actionButton} />
        )}
        <View style={styles.actionButton}>
          <Button
            title={
              busy ? "Changing..." : step === "current" ? "Continue" : "Submit"
            }
            disabled={busy}
            onPress={
              step === "current" ? continueFromCurrent : () => void submit()
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 68,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { flex: 1, fontSize: 16, fontWeight: "800" },
  chevron: { fontSize: 28, lineHeight: 30 },
  flow: {
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderRadius: 18,
  },
  flowHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: "900" },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontSize: 30, lineHeight: 32 },
  fields: { gap: 12 },
  actions: { flexDirection: "row", gap: 10 },
  actionButton: { flex: 1 },
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
        const first = value.find(
          (item): item is string =>
            typeof item === "string" && Boolean(item.trim()),
        );
        if (first) return first;
      }
    }
  }

  return error.message || `Request failed with ${error.status}`;
}
