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
import { Button, useResponsive, useTheme } from "@/components/ui";
import { FlowHeader } from "@/components/FlowHeader";
import { AppText } from "@/components/foundation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { credentialOutcome, credentialUserId } from "@/lib/authCredentialOutcome";
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

const getUserId = credentialUserId;

const getMessage = (payload: unknown, fallback: string) => {
  if (!isRecord(payload)) return fallback;
  return readString(payload.message) ?? readString(payload.error) ?? fallback;
};

export default function AuthScreen() {
  const auth = useAuth();
  const responsive = useResponsive();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
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
        // No OTP step of its own: a code is asked for only when the backend
        // withholds the session (`credentialOutcome`), never pre-emptively.
        const trimmedEmail = email.trim();
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
        if (credentialOutcome(payload) === "verify") {
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
        const outcome = credentialOutcome(payload);
        if (outcome === "verify") {
          // The backend withheld the session: its verification code is required.
          showOtp(
            payload,
            "Account created. Enter the 6-digit OTP sent to your email.",
          );
          return;
        }
        if (outcome === "signIn") {
          // Created without a session: sign in normally (no OTP step).
          setPassword("");
          setPasswordConfirmation("");
          setMode("login");
          setMessage("Account created. Sign in to continue.");
          toast.showToast({ variant: "success", title: "Account created", message: "Sign in to continue." });
          return;
        }
        // `session`: the service already saved the token; finish below.
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

  // v3 copy per production mode. Every mode is backed by an existing
  // authService call; nothing here changes what is sent.
  const title =
    mode === "login"
      ? "Sign in"
      : mode === "register"
        ? "Create account"
        : mode === "complete-phone"
          ? "Add your phone"
          : mode === "otp" || mode === "forgot-otp"
            ? "Check your email"
            : mode === "forgot-email"
              ? "Forgot password"
              : "New password";
  const detail =
    mode === "login"
      ? "Use your LFA Tickets account to buy and view tickets."
      : mode === "register"
        ? null
        : mode === "complete-phone"
          ? "Please add your phone number to continue."
          : mode === "otp"
            ? "Enter the 6-digit code we sent to the email on your account."
            : mode === "forgot-email"
              ? "Enter the email you signed up with and we'll send you a 6-digit code to reset your password."
              : mode === "forgot-otp"
                ? `Enter the 6-digit code we sent to ${recoveryEmail}.`
                : "Enter and confirm the new password for your account.";
  const primaryLabel = loading
    ? "Please wait..."
    : mode === "login"
      ? "Sign in"
      : mode === "register"
        ? "Create account"
        : mode === "complete-phone"
          ? "Continue"
          : mode === "otp"
            ? "Verify"
            : mode === "forgot-email"
              ? "Send code"
              : mode === "forgot-otp"
                ? "Verify code"
                : "Reset password";
  const primaryDisabled =
    loading ||
    (mode === "login" && (!email || !password)) ||
    (mode === "register" && (!name || !email || !password || !passwordConfirmation)) ||
    (mode === "complete-phone" && completionPhone.validation !== "valid") ||
    (mode === "otp" && (!pendingOtpTarget || otp.length !== 6)) ||
    (mode === "forgot-email" && !recoveryEmail) ||
    (mode === "forgot-otp" && recoveryCode.length !== 6) ||
    (mode === "reset-password" && (!recoveryPassword || !recoveryPasswordConfirmation));
  const showsLogo = mode === "login";
  const showsMailIcon = mode === "otp" || mode === "forgot-otp";

  return (
    <View style={[local.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView style={local.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <FlowHeader
            title=""
            backLabel={mode === "login" ? "Back" : mode === "register" || mode === "forgot-email" ? "Sign in" : "Back"}
            onBack={goBack}
          />
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={local.scrollContent}
          >
            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(280)}
              style={local.panel}
            >
              {showsLogo ? (
                <Image
                  source={require("../../assets/images/lfa-logo.png")}
                  style={local.logo}
                  resizeMode="contain"
                  accessibilityLabel="Lebanese Football Association"
                />
              ) : null}
              {showsMailIcon ? (
                <View style={[local.mailIcon, { backgroundColor: theme.colors.tones.brand.bg }]}>
                  <SymbolView name={{ ios: "envelope", android: "mail", web: "mail" }} size={30} tintColor={theme.colors.actionPrimary} fallback={<View />} />
                </View>
              ) : null}
              <AppText
                variant="displayPrompt"
                align={showsLogo ? "center" : "start"}
                accessibilityRole="header"
              >
                {title}
              </AppText>
              {detail ? (
                <AppText variant="body" tone="muted" align={showsLogo ? "center" : "start"}>
                  {detail}
                </AppText>
              ) : null}

              <View style={local.fields}>
                {mode === "register" ? (
                  <Field
                    label="Full name"
                    placeholder="Full Name"
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    textContentType="name"
                    editable={!loading}
                  />
                ) : null}

                {mode === "login" || mode === "register" ? (
                  <>
                    <Field
                      label="Email (optional)"
                      placeholder="name@example.com"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="emailAddress"
                      editable={!loading}
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
                    <PasswordField
                      label="Password"
                      placeholder={mode === "register" ? "At least 8 characters" : undefined}
                      value={password}
                      onChangeText={setPassword}
                      visible={showPassword}
                      onToggle={() => setShowPassword((value) => !value)}
                      editable={!loading}
                      newPassword={mode === "register"}
                    />
                    {mode === "register" ? (
                      <PasswordField
                        label="Confirm password"
                        value={passwordConfirmation}
                        onChangeText={setPasswordConfirmation}
                        visible={showPasswordConfirmation}
                        onToggle={() => setShowPasswordConfirmation((value) => !value)}
                        editable={!loading}
                        newPassword
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
                  <Field
                    label="6-digit code"
                    value={otp}
                    onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    code
                  />
                ) : mode === "forgot-email" ? (
                  <Field
                    label="Email"
                    placeholder="name@example.com"
                    value={recoveryEmail}
                    onChangeText={setRecoveryEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="emailAddress"
                    editable={!loading}
                  />
                ) : mode === "forgot-otp" ? (
                  <Field
                    label="6-digit code"
                    value={recoveryCode}
                    onChangeText={(value) =>
                      setRecoveryCode(value.replace(/\D/g, "").slice(0, 6))
                    }
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!loading}
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    code
                  />
                ) : (
                  <>
                    <PasswordField
                      label="New password"
                      placeholder="At least 8 characters"
                      value={recoveryPassword}
                      onChangeText={setRecoveryPassword}
                      visible={showRecoveryPassword}
                      onToggle={() => setShowRecoveryPassword((value) => !value)}
                      editable={!loading}
                      newPassword
                    />
                    <PasswordField
                      label="Confirm new password"
                      value={recoveryPasswordConfirmation}
                      onChangeText={setRecoveryPasswordConfirmation}
                      visible={showRecoveryPasswordConfirmation}
                      onToggle={() => setShowRecoveryPasswordConfirmation((value) => !value)}
                      editable={!loading}
                      newPassword
                    />
                  </>
                )}

                {mode === "login" ? (
                  <View style={local.loginRow}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel="Remember me"
                      accessibilityState={{ checked: remember, disabled: loading }}
                      aria-checked={remember}
                      aria-disabled={loading}
                      disabled={loading}
                      onPress={() => setRemember((value) => !value)}
                      style={local.rememberRow}
                    >
                      <View
                        style={[
                          local.checkbox,
                          {
                            borderColor: remember ? theme.colors.actionPrimary : theme.colors.border,
                            backgroundColor: remember ? theme.colors.actionPrimary : theme.colors.surface,
                          },
                        ]}
                      >
                        {remember ? (
                          <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={14} tintColor="#FFFFFF" fallback={<Text style={local.checkmark}>✓</Text>} />
                        ) : null}
                      </View>
                      <AppText variant="meta">Remember me</AppText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Forgot password"
                      onPress={startRecovery}
                      disabled={loading}
                      hitSlop={8}
                      style={local.linkButton}
                    >
                      <AppText variant="meta" style={{ color: theme.colors.brandInk }}>Forgot password?</AppText>
                    </Pressable>
                  </View>
                ) : null}

                {mode === "register" ? (
                  <AppText variant="meta" tone="muted" style={local.note}>{"We'll email you a code to verify your address."}</AppText>
                ) : null}

                {message ? (
                  <AppText variant="meta" tone="muted" accessibilityLiveRegion="polite" style={local.note}>{message}</AppText>
                ) : null}
              </View>
            </Animated.View>
          </ScrollView>

          <View style={local.actions}>
            <Button title={primaryLabel} disabled={primaryDisabled} loading={loading} onPress={submit} />
            {mode === "login" ? (
              <Button title="Create account" variant="tonal" onPress={() => switchMode("register")} />
            ) : mode === "register" || mode === "otp" ? (
              <Button title={mode === "otp" ? "Back to sign in" : "I already have an account"} variant="ghost" onPress={() => switchMode("login")} />
            ) : mode === "complete-phone" ? (
              <Button title="Back to sign in" variant="ghost" onPress={cancelPhoneCompletion} disabled={loading} />
            ) : (
              <Button title="Cancel password reset" variant="ghost" onPress={resetRecovery} />
            )}
            {mode === "otp" ? (
              <Button
                title={resending ? "Sending..." : "Resend code"}
                variant="ghost"
                tone="muted"
                disabled={resending || !pendingOtpTarget}
                onPress={resendOtp}
              />
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

type FieldProps = {
  label: string;
  /** A one-time code: large, spaced digits (v3 code boxes as one field). */
  code?: boolean;
} & Pick<
  React.ComponentProps<typeof TextInput>,
  | "value"
  | "onChangeText"
  | "placeholder"
  | "keyboardType"
  | "autoCapitalize"
  | "autoCorrect"
  | "maxLength"
  | "editable"
  | "textContentType"
  | "autoComplete"
>;

/** v3 field: muted label, 52pt input, radius 12, hairline ring (2pt brand ring while focused). */
function Field({ label, code = false, ...inputProps }: FieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={local.inputWrap}>
      <AppText variant="meta" tone="muted" style={local.label}>{label}</AppText>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={theme.colors.textMuted}
        style={[
          local.input,
          code && local.codeInput,
          {
            color: theme.colors.textStrong,
            backgroundColor: theme.colors.surface,
            borderColor: focused ? theme.colors.actionPrimary : theme.colors.border,
            borderWidth: focused ? 2 : 1,
          },
        ]}
      />
    </View>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggle,
  editable,
  placeholder,
  newPassword = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  editable: boolean;
  placeholder?: string;
  newPassword?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={local.inputWrap}>
      <AppText variant="meta" tone="muted" style={local.label}>{label}</AppText>
      <View
        style={[
          local.passwordField,
          {
            backgroundColor: theme.colors.surface,
            borderColor: focused ? theme.colors.actionPrimary : theme.colors.border,
            borderWidth: focused ? 2 : 1,
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
          placeholder={placeholder}
          textContentType={newPassword ? "newPassword" : "password"}
          accessibilityLabel={label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={theme.colors.textMuted}
          style={[local.passwordInput, { color: theme.colors.textStrong }]}
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
            tintColor={theme.colors.textMuted}
            fallback={<Text style={{ color: theme.colors.textMuted }}>{visible ? "Hide" : "Show"}</Text>}
          />
        </Pressable>
      </View>
    </View>
  );
}

const local = {
  screen: { flex: 1, alignItems: "center" as const },
  keyboard: { flex: 1, width: "100%" as const, alignItems: "center" as const },
  shell: { flex: 1, alignSelf: "center" as const },
  scrollContent: { flexGrow: 1, paddingBottom: 16 },
  // v3 auth: padding 30 20 8, readable width on tablets.
  panel: { width: "100%" as const, maxWidth: 520, alignSelf: "center" as const, gap: 8, paddingTop: 14 },
  logo: { width: 72, height: 72, alignSelf: "center" as const, marginBottom: 16 },
  mailIcon: { width: 64, height: 64, borderRadius: 18, alignItems: "center" as const, justifyContent: "center" as const, marginBottom: 12 },
  fields: { gap: 12, marginTop: 20 },
  inputWrap: { gap: 6 },
  label: { paddingStart: 4, fontWeight: "500" as const },
  input: { minHeight: 52, borderRadius: 12, paddingHorizontal: 14, fontSize: 17 },
  codeInput: { textAlign: "center" as const, fontSize: 24, fontWeight: "600" as const, letterSpacing: 10 },
  passwordField: { minHeight: 52, borderRadius: 12, flexDirection: "row" as const, alignItems: "center" as const },
  passwordInput: { flex: 1, minHeight: 50, paddingHorizontal: 14, fontSize: 17 },
  visibilityButton: { width: 48, height: 48, alignItems: "center" as const, justifyContent: "center" as const },
  loginRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 8 },
  rememberRow: { minHeight: 44, flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingEnd: 12 },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderRadius: 6, alignItems: "center" as const, justifyContent: "center" as const },
  checkmark: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" as const },
  linkButton: { minHeight: 44, justifyContent: "center" as const, paddingStart: 12 },
  note: { paddingHorizontal: 4, fontWeight: "400" as const },
  // v3 bottom actions: 52pt primary, secondary below (the keyboard lifts them).
  actions: { width: "100%" as const, maxWidth: 520, alignSelf: "center" as const, gap: 10, paddingTop: 12, paddingBottom: 10 },
};
