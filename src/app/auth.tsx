import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import Animated, {
  FadeInDown,
  useReducedMotion,
} from "react-native-reanimated";
import {
  Button,
  Card,
  Input,
  Screen,
  useResponsive,
  useTheme,
} from "@/components/ui";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/services/api";
import { authService, type OtpTarget } from "@/services/auth";
import { createAuthSubmissionGuard } from "@/lib/authSubmissionGuard";
import {
  createEmptyPhoneValue,
  toBackendPhoneDigits,
  type PhoneValue,
} from "@/lib/phoneNumber";
import { backendProvidedError, userFacingError } from "@/lib/userFacingError";
import { getSafeAuthReturnRoute } from "@/lib/authReturnRoute";

type Mode =
  | "login"
  | "register"
  | "otp"
  | "complete-phone"
  | "forgot-email"
  | "forgot-otp"
  | "reset-password";

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const getUserId = (payload: unknown) => {
  if (!isRecord(payload)) return null;
  if (
    typeof payload.user_id === "number" ||
    typeof payload.user_id === "string"
  )
    return String(payload.user_id);
  if (
    isRecord(payload.user) &&
    (typeof payload.user.id === "number" || typeof payload.user.id === "string")
  ) {
    return String(payload.user.id);
  }
  if (isRecord(payload.data)) return getUserId(payload.data);
  return null;
};

const hasSessionToken = (payload: unknown): boolean => {
  if (!isRecord(payload)) return false;
  if (readString(payload.token) || readString(payload.access_token))
    return true;
  return hasSessionToken(payload.data);
};

const getVerificationStatus = (payload: unknown): boolean | null => {
  if (!isRecord(payload)) return null;
  if (typeof payload.email_verified === "boolean")
    return payload.email_verified;
  if (typeof payload.verified === "boolean") return payload.verified;
  if (typeof payload.is_verified === "boolean") return payload.is_verified;
  if (
    typeof payload.email_verified_at === "string" &&
    payload.email_verified_at.trim()
  )
    return true;
  if (payload.email_verified_at === null) return false;
  return (
    getVerificationStatus(payload.user) ?? getVerificationStatus(payload.data)
  );
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
  const [remember, setRemember] = useState(false);
  const [registrationPhone, setRegistrationPhone] = useState<PhoneValue>(() =>
    createEmptyPhoneValue(),
  );
  const [completionPhone, setCompletionPhone] = useState<PhoneValue>(() =>
    createEmptyPhoneValue(),
  );
  const [otp, setOtp] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordConfirmation, setRecoveryPasswordConfirmation] =
    useState("");
  const [pendingOtpTarget, setPendingOtpTarget] = useState<OtpTarget | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] =
    useState(false);
  const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
  const [
    showRecoveryPasswordConfirmation,
    setShowRecoveryPasswordConfirmation,
  ] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submissionGuard = useRef(createAuthSubmissionGuard());
  const mountedRef = useRef(true);
  const reduceMotion = useReducedMotion();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = getSafeAuthReturnRoute(params.returnTo);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const showOtp = (
    payload: unknown,
    fallback: string,
    fallbackEmail = email.trim(),
  ) => {
    const userId = getUserId(payload);
    const nextMessage = getMessage(payload, fallback);
    setPendingOtpTarget({ userId, email: fallbackEmail || null });
    setMode("otp");
    setMessage(nextMessage);
    toast.showToast({
      variant: "info",
      title: "OTP required",
      message: nextMessage,
    });
  };

  const submit = async () => {
    if (!submissionGuard.current.tryAcquire()) return;
    setLoading(true);
    setMessage(null);
    try {
      if (mode === "login") {
        const trimmedEmail = email.trim();
        const verification =
          await authService.checkEmailVerification(trimmedEmail);
        if (!mountedRef.current) return;
        if (verification && getVerificationStatus(verification) === false) {
          showOtp(
            verification,
            "Please verify your email. A new code has been sent.",
            trimmedEmail,
          );
          return;
        }

        const result = await authService.login(
          trimmedEmail,
          password,
          remember,
        );
        if (!mountedRef.current) return;
        if (result.status === "phone_required") {
          setEmail(trimmedEmail);
          setCompletionPhone(createEmptyPhoneValue());
          setMode("complete-phone");
          setMessage(result.message);
          return;
        }
        const payload = result.payload;
        const userId = getUserId(payload);
        if (userId && !hasSessionToken(payload)) {
          showOtp(
            payload,
            "Please verify your email. A new code has been sent.",
            trimmedEmail,
          );
          return;
        }
      }

      if (mode === "complete-phone") {
        if (completionPhone.validation !== "valid") {
          const nextMessage =
            "Enter a valid phone number for the selected phone country.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "warning",
            title: "Phone number required",
            message: nextMessage,
          });
          return;
        }
        await authService.completePhone(
          email.trim(),
          password,
          toBackendPhoneDigits(completionPhone.canonicalPhone),
        );
        if (!mountedRef.current) return;
        setPassword("");
        setCompletionPhone(createEmptyPhoneValue());
      }

      if (mode === "register") {
        if (password !== passwordConfirmation) {
          const nextMessage = "Password confirmation does not match.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "error",
            title: "Check password",
            message: nextMessage,
          });
          return;
        }
        if (
          registrationPhone.validation === "invalid" ||
          registrationPhone.validation === "excluded-country"
        ) {
          const nextMessage =
            "Enter a valid phone number for the selected phone country.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "error",
            title: "Check phone",
            message: nextMessage,
          });
          return;
        }
        const payload = await authService.register(
          name.trim(),
          email.trim(),
          password,
          passwordConfirmation,
          toBackendPhoneDigits(registrationPhone.canonicalPhone),
        );
        if (!mountedRef.current) return;
        showOtp(
          payload,
          "Account created. Enter the 6-digit OTP sent to your email.",
        );
        return;
      }

      if (mode === "otp") {
        if (!pendingOtpTarget || otp.length !== 6) {
          const nextMessage = "Enter the 6-digit OTP sent to your email.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "warning",
            title: "OTP incomplete",
            message: nextMessage,
          });
          return;
        }
        await authService.verifyOtp(pendingOtpTarget, otp);
        if (!mountedRef.current) return;
      }

      if (mode === "forgot-email") {
        const trimmedEmail = recoveryEmail.trim();
        if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
          const nextMessage = "Enter a valid email address.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "warning",
            title: "Check email",
            message: nextMessage,
          });
          return;
        }
        await authService.forgotPassword(trimmedEmail);
        if (!mountedRef.current) return;
        setRecoveryEmail(trimmedEmail);
        setRecoveryCode("");
        setMode("forgot-otp");
        const nextMessage = "Enter the 6-digit OTP sent to your email.";
        setMessage(nextMessage);
        toast.showToast({
          variant: "success",
          title: "OTP sent",
          message: nextMessage,
        });
        return;
      }

      if (mode === "forgot-otp") {
        if (recoveryCode.length !== 6) {
          const nextMessage = "Enter the 6-digit OTP sent to your email.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "warning",
            title: "OTP incomplete",
            message: nextMessage,
          });
          return;
        }
        await authService.verifyForgotPasswordOtp(recoveryEmail, recoveryCode);
        if (!mountedRef.current) return;
        setMode("reset-password");
        setMessage(null);
        return;
      }

      if (mode === "reset-password") {
        if (!recoveryPassword || !recoveryPasswordConfirmation) {
          const nextMessage = "Enter and confirm your new password.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "warning",
            title: "Password required",
            message: nextMessage,
          });
          return;
        }
        if (recoveryPassword !== recoveryPasswordConfirmation) {
          const nextMessage = "Password confirmation does not match.";
          setMessage(nextMessage);
          toast.showToast({
            variant: "error",
            title: "Check password",
            message: nextMessage,
          });
          return;
        }
        await authService.resetPassword(
          recoveryEmail,
          recoveryCode,
          recoveryPassword,
          recoveryPasswordConfirmation,
        );
        if (!mountedRef.current) return;
        setEmail(recoveryEmail);
        resetRecovery();
        toast.showToast({
          variant: "success",
          title: "Password reset",
          message: "Your password was reset. You can now log in.",
        });
        return;
      }

      await auth.refreshAuth();
      if (!mountedRef.current) return;
      toast.showToast({
        variant: "success",
        title: "Signed in",
        message: "Welcome back.",
      });
      if (returnTo) router.dismissTo(returnTo as never);
      else router.replace("/");
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && mode === "login" && getUserId(err.body)) {
        showOtp(
          err.body,
          "Please verify your email. A new code has been sent.",
          email.trim(),
        );
        return;
      }
      const isRecovery =
        mode === "forgot-email" ||
        mode === "forgot-otp" ||
        mode === "reset-password";
      const nextMessage = isRecovery
        ? backendProvidedError(
            err,
            "Unable to continue. Check your details and try again.",
          )
        : userFacingError(
            err,
            mode === "complete-phone"
              ? "Could not add your phone number. Please try again."
              : "Unable to continue. Check your details and try again.",
          );
      setMessage(nextMessage);
      toast.showToast({
        variant: "error",
        title: "Unable to continue",
        message: nextMessage,
      });
    } finally {
      submissionGuard.current.release();
      if (mountedRef.current) setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!pendingOtpTarget) return;
    setResending(true);
    setMessage(null);
    try {
      const payload = await authService.resendOtp(pendingOtpTarget);
      const nextMessage = getMessage(
        payload,
        "A new OTP was sent to your email.",
      );
      setMessage(nextMessage);
      toast.showToast({
        variant: "success",
        title: "OTP sent",
        message: nextMessage,
      });
    } catch (err) {
      const nextMessage = userFacingError(
        err,
        "Unable to resend the code. Please try again.",
      );
      setMessage(nextMessage);
      toast.showToast({
        variant: "error",
        title: "Could not resend OTP",
        message: nextMessage,
      });
    } finally {
      setResending(false);
    }
  };

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setMessage(null);
    setOtp("");
    setPendingOtpTarget(null);
  };

  const cancelPhoneCompletion = () => {
    setPassword("");
    setCompletionPhone(createEmptyPhoneValue());
    setMessage(null);
    setMode("login");
  };

  const resetRecovery = () => {
    setMode("login");
    setRecoveryEmail("");
    setRecoveryCode("");
    setRecoveryPassword("");
    setRecoveryPasswordConfirmation("");
    setShowRecoveryPassword(false);
    setShowRecoveryPasswordConfirmation(false);
    setMessage(null);
  };

  const startRecovery = () => {
    setRecoveryEmail(email.trim());
    setRecoveryCode("");
    setRecoveryPassword("");
    setRecoveryPasswordConfirmation("");
    setMessage(null);
    setMode("forgot-email");
  };

  const goBack = () => {
    if (mode === "complete-phone") return cancelPhoneCompletion();
    if (mode === "forgot-email") return resetRecovery();
    if (mode === "forgot-otp") {
      setMode("forgot-email");
      setMessage(null);
      return;
    }
    if (mode === "reset-password") {
      setMode("forgot-otp");
      setMessage(null);
      return;
    }
    if (returnTo) {
      setPassword("");
      router.dismissTo(returnTo as never);
      return;
    }
    setPassword("");
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const title =
    mode === "login"
      ? "Login to your account"
      : mode === "register"
        ? "Create your account"
        : mode === "complete-phone"
          ? "Complete your profile"
        : mode === "otp"
          ? "Enter registration OTP"
          : mode === "forgot-email"
            ? "Reset your password"
            : mode === "forgot-otp"
              ? "Enter reset OTP"
              : "Choose a new password";
  const detail =
    mode === "login"
      ? "Access your orders, tickets, and downloadable PDFs."
      : mode === "register"
        ? "After registration, an OTP will be sent to your email for confirmation."
        : mode === "complete-phone"
          ? "Please add your phone number to continue."
        : mode === "otp"
          ? "We sent a 6-digit code to the email on your account."
          : mode === "forgot-email"
            ? "Enter your account email and we’ll send you a reset code."
            : mode === "forgot-otp"
              ? `We sent a 6-digit code to ${recoveryEmail}.`
              : "Enter and confirm the new password for your account.";

  return (
    <Screen>
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <View style={local.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              mode.startsWith("forgot-") || mode === "reset-password"
                ? "Back in password recovery"
                : "Go back"
            }
            onPress={goBack}
            style={[
              local.backButton,
              {
                backgroundColor: theme.colors.panel,
                borderColor: theme.colors.line,
              },
            ]}
          >
            <View
              style={[local.backChevron, { borderColor: theme.colors.ink }]}
            />
          </Pressable>
          <View style={local.headerBrand}>
            <Image
              source={require("../../assets/images/lfa-logo.png")}
              style={local.logo}
              resizeMode="contain"
            />
            <Text style={[local.headerTitle, { color: theme.colors.ink }]}>
              Lebanon FA
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          style={local.keyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={local.scrollContent}
          >
            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(280)}
              style={local.authPanel}
            >
              <Card>
                <Text style={theme.styles.sectionLabel}>
                  Lebanon FA Account
                </Text>
                <Text style={[local.title, { color: theme.colors.ink }]}>
                  {title}
                </Text>
                <Text style={theme.styles.muted}>{detail}</Text>
              </Card>

              <Card>
                {mode === "register" ? (
                  <Input
                    label="Full name"
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                  />
                ) : null}

                {mode === "login" || mode === "register" ? (
                  <>
                    <Input
                      label="Email"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    {mode === "register" ? (
                        <InternationalPhoneInput
                          value={registrationPhone}
                          disabled={loading}
                          error={
                            registrationPhone.validation === "invalid" ||
                            registrationPhone.validation === "excluded-country"
                              ? "Enter a valid phone number for the selected phone country."
                              : undefined
                          }
                          onChange={setRegistrationPhone}
                        />
                    ) : null}
                    <PasswordInput
                      label="Password"
                      value={password}
                      onChangeText={setPassword}
                      visible={showPassword}
                      onToggle={() => setShowPassword((value) => !value)}
                      editable={!loading}
                    />
                    {mode === "register" ? (
                        <PasswordInput
                          label="Confirm password"
                          value={passwordConfirmation}
                          onChangeText={setPasswordConfirmation}
                          visible={showPasswordConfirmation}
                          onToggle={() =>
                            setShowPasswordConfirmation((value) => !value)
                          }
                          editable={!loading}
                        />
                    ) : null}
                  </>
                ) : mode === "complete-phone" ? (
                  <InternationalPhoneInput
                    value={completionPhone}
                    disabled={loading}
                    error={
                      completionPhone.validation === "invalid" ||
                      completionPhone.validation === "excluded-country"
                        ? "Enter a valid phone number for the selected phone country."
                        : undefined
                    }
                    onChange={setCompletionPhone}
                  />
                ) : mode === "otp" ? (
                  <Input
                    label="6-digit OTP"
                    value={otp}
                    onChangeText={(value) =>
                      setOtp(value.replace(/\D/g, "").slice(0, 6))
                    }
                    keyboardType="number-pad"
                    maxLength={6}
                    style={local.otpInput}
                  />
                ) : mode === "forgot-email" ? (
                  <Input
                    label="Email"
                    value={recoveryEmail}
                    onChangeText={setRecoveryEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!loading}
                  />
                ) : mode === "forgot-otp" ? (
                  <Input
                    label="6-digit OTP"
                    value={recoveryCode}
                    onChangeText={(value) =>
                      setRecoveryCode(value.replace(/\D/g, "").slice(0, 6))
                    }
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!loading}
                    style={local.otpInput}
                  />
                ) : (
                  <>
                    <PasswordInput
                      label="New password"
                      value={recoveryPassword}
                      onChangeText={setRecoveryPassword}
                      visible={showRecoveryPassword}
                      onToggle={() =>
                        setShowRecoveryPassword((value) => !value)
                      }
                      editable={!loading}
                    />
                    <PasswordInput
                      label="Confirm new password"
                      value={recoveryPasswordConfirmation}
                      onChangeText={setRecoveryPasswordConfirmation}
                      visible={showRecoveryPasswordConfirmation}
                      onToggle={() =>
                        setShowRecoveryPasswordConfirmation((value) => !value)
                      }
                      editable={!loading}
                    />
                  </>
                )}

                {mode === "login" ? (
                  <>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel="Remember me"
                      accessibilityState={{
                        checked: remember,
                        disabled: loading,
                      }}
                      disabled={loading}
                      onPress={() => setRemember((value) => !value)}
                      style={local.rememberRow}
                    >
                      <View
                        style={[
                          local.checkbox,
                          {
                            borderColor: remember
                              ? theme.colors.primary
                              : theme.colors.line,
                            backgroundColor: remember
                              ? theme.colors.primary
                              : theme.colors.panel,
                          },
                        ]}
                      >
                        {remember ? (
                          <Text style={local.checkmark}>✓</Text>
                        ) : null}
                      </View>
                      <Text
                        style={[
                          local.rememberLabel,
                          { color: theme.colors.ink },
                        ]}
                      >
                        Remember me
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Forgot password"
                      onPress={startRecovery}
                      disabled={loading}
                      hitSlop={8}
                      style={local.forgotButton}
                    >
                      <Text
                        style={[
                          local.footerLink,
                          { color: theme.colors.primary },
                        ]}
                      >
                        Forgot Password?
                      </Text>
                    </Pressable>
                  </>
                ) : null}

                {message ? (
                  <Text
                    style={[local.message, { color: theme.colors.secondary }]}
                  >
                    {message}
                  </Text>
                ) : null}

                <Button
                  title={
                    loading
                      ? "Please wait..."
                      : mode === "login"
                        ? "Login"
                      : mode === "register"
                          ? "Register"
                          : mode === "complete-phone"
                            ? "Continue"
                          : mode === "otp"
                            ? "Confirm email"
                            : mode === "forgot-email"
                              ? "Send OTP"
                              : mode === "forgot-otp"
                                ? "Verify OTP"
                                : "Reset Password"
                  }
                  disabled={
                    loading ||
                    (mode === "login" && (!email || !password)) ||
                    (mode === "register" &&
                      (!name ||
                        !email ||
                        !password ||
                        !passwordConfirmation)) ||
                    (mode === "complete-phone" &&
                      completionPhone.validation !== "valid") ||
                    (mode === "otp" &&
                      (!pendingOtpTarget || otp.length !== 6)) ||
                    (mode === "forgot-email" && !recoveryEmail) ||
                    (mode === "forgot-otp" && recoveryCode.length !== 6) ||
                    (mode === "reset-password" &&
                      (!recoveryPassword || !recoveryPasswordConfirmation))
                  }
                  onPress={submit}
                />

                {mode === "otp" ? (
                  <Button
                    title={resending ? "Sending..." : "Resend OTP"}
                    variant="secondary"
                    disabled={resending || !pendingOtpTarget}
                    onPress={resendOtp}
                  />
                ) : null}
              </Card>

              {mode === "login" ? (
                <Text
                  style={[local.footerText, { color: theme.colors.secondary }]}
                >
                  Need an account?{" "}
                  <Text
                    style={[local.footerLink, { color: theme.colors.primary }]}
                    onPress={() => switchMode("register")}
                  >
                    Register
                  </Text>
                </Text>
              ) : mode === "register" ? (
                <Text
                  style={[local.footerText, { color: theme.colors.secondary }]}
                >
                  Already have an account?{" "}
                  <Text
                    style={[local.footerLink, { color: theme.colors.primary }]}
                    onPress={() => switchMode("login")}
                  >
                    Login
                  </Text>
                </Text>
              ) : mode === "otp" ? (
                <Text
                  style={[local.footerText, { color: theme.colors.secondary }]}
                >
                  Already confirmed?{" "}
                  <Text
                    style={[local.footerLink, { color: theme.colors.primary }]}
                    onPress={() => switchMode("login")}
                  >
                    Login
                  </Text>
                </Text>
              ) : mode === "complete-phone" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel phone completion"
                  onPress={cancelPhoneCompletion}
                  disabled={loading}
                  hitSlop={8}
                >
                  <Text
                    style={[
                      local.footerText,
                      local.footerLink,
                      { color: theme.colors.primary },
                    ]}
                  >
                    Back to login
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={resetRecovery}
                  hitSlop={8}
                >
                  <Text
                    style={[
                      local.footerText,
                      local.footerLink,
                      { color: theme.colors.primary },
                    ]}
                  >
                    Cancel password recovery
                  </Text>
                </Pressable>
              )}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Screen>
  );
}

function PasswordInput({
  label,
  value,
  onChangeText,
  visible,
  onToggle,
  editable,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  editable: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={local.inputWrap}>
      <Text style={theme.styles.label}>{label}</Text>
      <View
        style={[
          local.passwordField,
          {
            backgroundColor: theme.colors.panel,
            borderColor: theme.colors.line,
          },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
          placeholderTextColor={theme.colors.muted}
          style={[local.passwordInput, { color: theme.colors.ink }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visible ? `Hide ${label}` : `Show ${label}`}
          onPress={onToggle}
          hitSlop={8}
          style={local.visibilityButton}
        >
          <SymbolView
            name={{
              ios: visible ? "eye.slash" : "eye",
              android: visible ? "visibility_off" : "visibility",
              web: visible ? "visibility_off" : "visibility",
            }}
            size={20}
            tintColor={theme.colors.muted}
            fallback={
              <Text style={{ color: theme.colors.muted }}>
                {visible ? "Hide" : "Show"}
              </Text>
            }
          />
        </Pressable>
      </View>
    </View>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  keyboard: { flex: 1 },
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
  inputWrap: { gap: 6 },
  passwordField: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  passwordInput: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  visibilityButton: {
    width: 48,
    height: 46,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  rememberRow: {
    minHeight: 44,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    alignSelf: "flex-start" as const,
    gap: 10,
    paddingRight: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: 6,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900" as const,
  },
  rememberLabel: { fontSize: 14, fontWeight: "700" as const },
  forgotButton: {
    minHeight: 44,
    alignSelf: "flex-end" as const,
    justifyContent: "center" as const,
    paddingLeft: 12,
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
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  backChevron: {
    width: 11,
    height: 11,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    transform: [{ rotate: "45deg" }],
    marginLeft: 4,
  },
  headerBrand: { alignItems: "center" as const, gap: 4 },
  headerTitle: { fontSize: 12, fontWeight: "900" as const },
  logo: { width: 42, height: 42 },
  title: { fontSize: 24, fontWeight: "900" as const, lineHeight: 30 },
  message: { fontSize: 13, lineHeight: 19 },
  otpInput: {
    textAlign: "center" as const,
    fontSize: 20,
    fontWeight: "800" as const,
    letterSpacing: 8,
  },
  footerText: { textAlign: "center" as const, fontSize: 14 },
  footerLink: { fontWeight: "900" as const },
};
