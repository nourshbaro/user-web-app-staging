import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Button, Card, Input, Screen, colors, styles, useResponsive, useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/services/api";
import { authService } from "@/services/auth";

type Mode = "login" | "register" | "otp";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const getUserId = (payload: unknown) => {
  if (!isRecord(payload)) return null;
  if (typeof payload.user_id === "number" || typeof payload.user_id === "string") return String(payload.user_id);
  if (isRecord(payload.user) && (typeof payload.user.id === "number" || typeof payload.user.id === "string")) {
    return String(payload.user.id);
  }
  if (isRecord(payload.data)) return getUserId(payload.data);
  return null;
};

const getMessage = (payload: unknown, fallback: string) => {
  if (!isRecord(payload)) return fallback;
  return readString(payload.message) ?? readString(payload.error) ?? fallback;
};

export default function AuthScreen() {
  const auth = useAuth();
  const responsive = useResponsive();
  const theme = useTheme();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const showOtp = (payload: unknown, fallback: string) => {
    const userId = getUserId(payload);
    const nextMessage = getMessage(payload, fallback);
    if (userId) setPendingUserId(userId);
    setMode("otp");
    setMessage(nextMessage);
    toast.showToast({ variant: "info", title: "OTP required", message: nextMessage });
  };

  const submit = async () => {
    setLoading(true);
    setMessage(null);
    try {
      if (mode === "login") {
        const payload = await authService.login(email.trim(), password);
        const userId = getUserId(payload);
        if (userId && isRecord(payload) && payload.expires_at) {
          showOtp(payload, "Please verify your email. A new code has been sent.");
          return;
        }
      }

      if (mode === "register") {
        if (password !== passwordConfirmation) {
          const nextMessage = "Password confirmation does not match.";
          setMessage(nextMessage);
          toast.showToast({ variant: "error", title: "Check password", message: nextMessage });
          return;
        }
        const payload = await authService.register(name.trim(), email.trim(), password, passwordConfirmation);
        showOtp(payload, "Account created. Enter the 6-digit OTP sent to your email.");
        return;
      }

      if (mode === "otp") {
        if (!pendingUserId || otp.length !== 6) {
          const nextMessage = "Enter the 6-digit OTP sent to your email.";
          setMessage(nextMessage);
          toast.showToast({ variant: "warning", title: "OTP incomplete", message: nextMessage });
          return;
        }
        await authService.verifyOtp(pendingUserId, otp);
      }

      await auth.refreshAuth();
      toast.showToast({ variant: "success", title: "Signed in", message: "Welcome back." });
      router.replace("/profile");
    } catch (err) {
      if (err instanceof ApiError && mode === "login" && getUserId(err.body)) {
        showOtp(err.body, "Please verify your email. A new code has been sent.");
        return;
      }
      const nextMessage = err instanceof Error ? err.message : "Please try again.";
      setMessage(nextMessage);
      toast.showToast({ variant: "error", title: "Unable to continue", message: nextMessage });
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!pendingUserId) return;
    setResending(true);
    setMessage(null);
    try {
      const payload = await authService.resendOtp(pendingUserId);
      const nextMessage = getMessage(payload, "A new OTP was sent to your email.");
      setMessage(nextMessage);
      toast.showToast({ variant: "success", title: "OTP sent", message: nextMessage });
    } catch (err) {
      const nextMessage = err instanceof Error ? err.message : "Unable to resend OTP.";
      setMessage(nextMessage);
      toast.showToast({ variant: "error", title: "Could not resend OTP", message: nextMessage });
    } finally {
      setResending(false);
    }
  };

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setMessage(null);
    setOtp("");
    setPendingUserId(null);
  };

  const title = mode === "login" ? "Login to your account" : mode === "register" ? "Create your account" : "Enter registration OTP";
  const detail = mode === "login"
    ? "Access your orders, tickets, and downloadable PDFs."
    : mode === "register"
      ? "After registration, an OTP will be sent to your email for confirmation."
      : "We sent a 6-digit code to the email on your account.";

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
      <View style={local.header}>
        <Pressable onPress={() => router.back()} style={[local.backButton, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}>
          <View style={[local.backChevron, { borderColor: theme.colors.ink }]} />
        </Pressable>
        <View style={local.headerBrand}>
          <Image source={require("../../assets/images/lfa-logo.png")} style={local.logo} resizeMode="contain" />
          <Text style={[local.headerTitle, { color: theme.colors.ink }]}>Lebanon FA</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={local.scrollContent}>
        <View style={local.authPanel}>
          <Card>
            <Text style={styles.sectionLabel}>Lebanon FA Account</Text>
            <Text style={[local.title, { color: theme.colors.ink }]}>{title}</Text>
            <Text style={styles.muted}>{detail}</Text>
          </Card>

          <Card>
            {mode === "register" ? (
              <Input label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
            ) : null}

            {mode !== "otp" ? (
              <>
                <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry />
                {mode === "register" ? (
                  <Input label="Confirm password" value={passwordConfirmation} onChangeText={setPasswordConfirmation} secureTextEntry />
                ) : null}
              </>
            ) : (
              <Input
                label="6-digit OTP"
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                style={local.otpInput}
              />
            )}

            {message ? <Text style={[local.message, { color: theme.colors.secondary }]}>{message}</Text> : null}

            <Button
              title={loading ? "Please wait..." : mode === "login" ? "Login" : mode === "register" ? "Register" : "Confirm email"}
              disabled={
                loading ||
                (mode === "login" && (!email || !password)) ||
                (mode === "register" && (!name || !email || !password || !passwordConfirmation)) ||
                (mode === "otp" && (!pendingUserId || otp.length !== 6))
              }
              onPress={submit}
            />

            {mode === "otp" ? (
              <Button title={resending ? "Sending..." : "Resend OTP"} variant="secondary" disabled={resending || !pendingUserId} onPress={resendOtp} />
            ) : null}
          </Card>

          {mode === "login" ? (
            <Text style={[local.footerText, { color: theme.colors.secondary }]}>
              Need an account? <Text style={local.footerLink} onPress={() => switchMode("register")}>Register</Text>
            </Text>
          ) : mode === "register" ? (
            <Text style={[local.footerText, { color: theme.colors.secondary }]}>
              Already have an account? <Text style={local.footerLink} onPress={() => switchMode("login")}>Login</Text>
            </Text>
          ) : (
            <Text style={[local.footerText, { color: theme.colors.secondary }]}>
              Already confirmed? <Text style={local.footerLink} onPress={() => switchMode("login")}>Login</Text>
            </Text>
          )}
        </View>
      </ScrollView>
      </View>
    </Screen>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center" as const,
    gap: 14,
    paddingBottom: 28,
  },
  authPanel: {
    width: "100%" as const,
    maxWidth: 520,
    gap: 14,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  backChevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.ink,
    transform: [{ rotate: "45deg" }],
    marginLeft: 4,
  },
  headerBrand: { alignItems: "center" as const, gap: 4 },
  headerTitle: { color: colors.ink, fontSize: 12, fontWeight: "900" as const },
  logo: { width: 42, height: 42 },
  title: { color: colors.ink, fontSize: 24, fontWeight: "900" as const, lineHeight: 30 },
  message: { color: colors.secondary, fontSize: 13, lineHeight: 19 },
  otpInput: { textAlign: "center" as const, fontSize: 20, fontWeight: "800" as const, letterSpacing: 8 },
  footerText: { color: colors.secondary, textAlign: "center" as const, fontSize: 14 },
  footerLink: { color: colors.primary, fontWeight: "900" as const },
};
