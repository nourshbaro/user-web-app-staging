import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useReducer, useRef, useState } from "react";
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
import { AppText, SegmentedControl } from "@/components/foundation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { InternationalPhoneInput } from "@/components/InternationalPhoneInput";
import { OtpCodeInput } from "@/components/account/OtpCodeInput";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { ApiError } from "@/services/api";
import { authService, type LoginIdentifier, type OtpTarget } from "@/services/auth";
import { createAuthSubmissionGuard } from "@/lib/authSubmissionGuard";
import {
  createEmptyPhoneValue,
  formatBackendPhoneForDisplay,
  toBackendPhoneDigits,
  type PhoneValue,
} from "@/lib/phoneNumber";
import {
  createRecoveryAttempts,
  forgotPasswordOutcome,
  initialRecoveryState,
  isValidRecoveryEmail,
  recoveryReducer,
  type RecoveryMethod,
} from "@/lib/passwordRecovery";
import { backendProvidedError, userFacingError } from "@/lib/userFacingError";
import { credentialOutcome, credentialUserId } from "@/lib/authCredentialOutcome";
import { getSafeAuthReturnRoute } from "@/lib/authReturnRoute";

type Mode = "login" | "register" | "otp" | "complete-phone" | "recovery";
type IdentifierMethod = RecoveryMethod;

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

const phoneError = (value: PhoneValue, message: string) =>
  value.validation === "invalid" || value.validation === "excluded-country" ? message : undefined;

export default function AuthScreen() {
  const auth = useAuth();
  const responsive = useResponsive();
  const theme = useTheme();
  const toast = useToast();
  const i18n = useI18n();
  const t = i18n.t;
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [remember, setRemember] = useState(false);
  // v3 sign in: email or phone number (the backend takes either field).
  const [loginMethod, setLoginMethod] = useState<IdentifierMethod>("email");
  const [loginPhone, setLoginPhone] = useState<PhoneValue>(() =>
    createEmptyPhoneValue(),
  );
  const [registrationPhone, setRegistrationPhone] = useState<PhoneValue>(() =>
    createEmptyPhoneValue(),
  );
  const [completionPhone, setCompletionPhone] = useState<PhoneValue>(() =>
    createEmptyPhoneValue(),
  );
  const [otp, setOtp] = useState("");
  // Password recovery: the step, method, bound phone and the address the code
  // went to are owned by `recoveryReducer`; these are only the field drafts.
  const recoveryAttempts = useRef(createRecoveryAttempts());
  const [recovery, dispatchRecovery] = useReducer(recoveryReducer, undefined, () => initialRecoveryState());
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryPhone, setRecoveryPhone] = useState<PhoneValue>(() =>
    createEmptyPhoneValue(),
  );
  const [addedEmail, setAddedEmail] = useState("");
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

  const notify = (
    variant: "info" | "success" | "warning" | "error",
    title: string,
    nextMessage: string,
  ) => {
    setMessage(nextMessage);
    toast.showToast({ variant, title, message: nextMessage });
  };

  const showOtp = (
    payload: unknown,
    fallback: string,
    fallbackEmail: string | null,
  ) => {
    const userId = getUserId(payload);
    const nextMessage = getMessage(payload, fallback);
    setPendingOtpTarget({ userId, email: fallbackEmail || null });
    setMode("otp");
    notify("info", t("auth.toast.codeRequired"), nextMessage);
  };

  /** A recovery answer still belongs to the flow only for the attempt that sent it. */
  const isRecoveryCurrent = (attempt: number) =>
    mountedRef.current && recoveryAttempts.current.isCurrent(attempt);

  const enterRecoveryCode = (attempt: number, codeEmail: string) => {
    setRecoveryCode("");
    dispatchRecovery({ type: "codeSent", attempt, email: codeEmail });
    // The step's own detail names the address; the toast only confirms it.
    setMessage(null);
    toast.showToast({ variant: "success", title: t("auth.toast.codeSent"), message: t("auth.code.detail", { email: codeEmail }) });
  };

  const submit = async () => {
    if (!submissionGuard.current.tryAcquire()) return;
    const recoveryAttempt = recoveryAttempts.current.current();
    setLoading(true);
    setMessage(null);
    try {
      if (mode === "login") {
        // No OTP step of its own: a code is asked for only when the backend
        // withholds the session (`credentialOutcome`), never pre-emptively.
        const trimmedEmail = email.trim();
        let identifier: LoginIdentifier;
        if (loginMethod === "email") {
          if (!isValidRecoveryEmail(trimmedEmail)) {
            notify("warning", t("auth.toast.checkDetails"), t("auth.error.email"));
            return;
          }
          identifier = { email: trimmedEmail };
        } else {
          if (loginPhone.validation !== "valid") {
            notify("warning", t("auth.toast.checkDetails"), t("auth.error.phone"));
            return;
          }
          identifier = { phone: toBackendPhoneDigits(loginPhone.canonicalPhone) };
        }
        const result = await authService.login(identifier, password, remember);
        if (!mountedRef.current) return;
        if (result.status === "phone_required") {
          // `complete-phone` is keyed by email: it only follows an email sign-in.
          if (!("email" in identifier)) {
            setMessage(result.message);
            return;
          }
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
            t("auth.otp.loginRequired"),
            "email" in identifier ? trimmedEmail : null,
          );
          return;
        }
      }

      if (mode === "complete-phone") {
        if (completionPhone.validation !== "valid") {
          notify("warning", t("auth.toast.checkDetails"), t("auth.error.phone"));
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
        // Email is optional; when given it must be a valid address.
        const registrationEmail = email.trim();
        if (registrationEmail && !isValidRecoveryEmail(registrationEmail)) {
          notify("error", t("auth.toast.checkDetails"), t("auth.error.email"));
          return;
        }
        if (password !== passwordConfirmation) {
          notify("error", t("auth.toast.checkDetails"), t("auth.error.passwordMismatch"));
          return;
        }
        if (registrationPhone.validation !== "valid") {
          notify("error", t("auth.toast.checkDetails"), t("auth.error.phone"));
          return;
        }
        const payload = await authService.register(
          name.trim(),
          registrationEmail || null,
          password,
          passwordConfirmation,
          toBackendPhoneDigits(registrationPhone.canonicalPhone),
        );
        if (!mountedRef.current) return;
        const outcome = credentialOutcome(payload);
        if (outcome === "verify") {
          // The backend withheld the session: its verification code is required.
          showOtp(payload, t("auth.otp.registerRequired"), registrationEmail || null);
          return;
        }
        if (outcome === "signIn") {
          // Created without a session: sign in normally (no OTP step), with
          // the identifier the account was created with.
          setPassword("");
          setPasswordConfirmation("");
          if (registrationEmail) {
            setLoginMethod("email");
          } else {
            setLoginMethod("phone");
            setLoginPhone(registrationPhone);
          }
          setMode("login");
          setMessage(t("auth.accountCreated"));
          toast.showToast({ variant: "success", title: t("auth.toast.accountCreated"), message: t("auth.toast.signInToContinue") });
          return;
        }
        // `session`: the service already saved the token; finish below.
      }

      if (mode === "otp") {
        if (!pendingOtpTarget || otp.length !== 6) {
          notify("warning", t("auth.toast.checkDetails"), t("auth.otp.required"));
          return;
        }
        await authService.verifyOtp(pendingOtpTarget, otp);
        if (!mountedRef.current) return;
      }

      if (mode === "recovery") {
        if (recovery.step === "identify" && recovery.method === "email") {
          const trimmedEmail = recoveryEmail.trim();
          if (!isValidRecoveryEmail(trimmedEmail)) {
            notify("warning", t("auth.toast.checkDetails"), t("auth.error.email"));
            return;
          }
          // The backend answers the same whether or not the address has an
          // account, so the flow always continues to the code.
          await authService.forgotPassword({ email: trimmedEmail });
          if (!isRecoveryCurrent(recoveryAttempt)) return;
          setRecoveryEmail(trimmedEmail);
          enterRecoveryCode(recoveryAttempt, trimmedEmail);
          return;
        }

        if (recovery.step === "identify") {
          if (recoveryPhone.validation !== "valid") {
            notify("warning", t("auth.toast.checkDetails"), t("auth.error.phone"));
            return;
          }
          const phone = toBackendPhoneDigits(recoveryPhone.canonicalPhone);
          const answer = await authService.forgotPassword({ phone });
          if (!isRecoveryCurrent(recoveryAttempt)) return;
          if (forgotPasswordOutcome(answer) === "emailRequired") {
            setAddedEmail("");
            dispatchRecovery({ type: "emailRequired", attempt: recoveryAttempt, phone });
            return;
          }
          // Backend dependency (docs/API_INTEGRATION.md §5.2): a phone account
          // that has an email gets the generic answer, and verify / reset
          // accept only `email` — there is no phone or recovery-token
          // contract to continue with. The flow neither advances nor asks
          // for the account's email; it shows the backend's own message.
          setMessage(getMessage(answer, t("auth.error.generic")));
          return;
        }

        if (recovery.step === "addEmail") {
          const trimmedEmail = addedEmail.trim();
          if (!isValidRecoveryEmail(trimmedEmail)) {
            notify("warning", t("auth.toast.checkDetails"), t("auth.error.email"));
            return;
          }
          // The phone the backend asked an email for in this attempt — never
          // the live phone field.
          const boundPhone = recovery.phone;
          if (!boundPhone) return;
          await authService.addRecoveryEmail(boundPhone, trimmedEmail);
          if (!isRecoveryCurrent(recoveryAttempt)) return;
          setAddedEmail(trimmedEmail);
          enterRecoveryCode(recoveryAttempt, trimmedEmail);
          return;
        }

        const codeEmail = recovery.email;
        if (!codeEmail) return;

        if (recovery.step === "code") {
          if (recoveryCode.length !== 6) {
            notify("warning", t("auth.toast.checkDetails"), t("auth.otp.required"));
            return;
          }
          await authService.verifyForgotPasswordOtp(codeEmail, recoveryCode);
          if (!isRecoveryCurrent(recoveryAttempt)) return;
          dispatchRecovery({ type: "codeVerified", attempt: recoveryAttempt });
          return;
        }

        if (!recoveryPassword || !recoveryPasswordConfirmation) {
          notify("warning", t("auth.toast.checkDetails"), t("auth.error.passwordRequired"));
          return;
        }
        if (recoveryPassword !== recoveryPasswordConfirmation) {
          notify("error", t("auth.toast.checkDetails"), t("auth.error.passwordMismatch"));
          return;
        }
        await authService.resetPassword(
          codeEmail,
          recoveryCode,
          recoveryPassword,
          recoveryPasswordConfirmation,
        );
        if (!isRecoveryCurrent(recoveryAttempt)) return;
        // Back to Sign in with the identifier the recovery used.
        const method = recovery.method;
        if (method === "phone") setLoginPhone(recoveryPhone);
        else setEmail(codeEmail);
        setLoginMethod(method);
        setPassword("");
        resetRecovery();
        toast.showToast({
          variant: "success",
          title: t("auth.toast.passwordReset"),
          message: t("auth.toast.passwordResetMessage"),
        });
        return;
      }

      await auth.refreshAuth();
      if (!mountedRef.current) return;
      toast.showToast({
        variant: "success",
        title: t("auth.toast.signedIn"),
        message: t("auth.toast.welcome"),
      });
      if (returnTo) router.dismissTo(returnTo as never);
      else router.replace("/");
    } catch (err) {
      if (!mountedRef.current) return;
      // A failure for an earlier recovery identifier is as stale as a success.
      if (mode === "recovery" && !recoveryAttempts.current.isCurrent(recoveryAttempt)) return;
      if (err instanceof ApiError && mode === "login" && getUserId(err.body)) {
        showOtp(
          err.body,
          t("auth.otp.loginRequired"),
          loginMethod === "email" ? email.trim() : null,
        );
        return;
      }
      // Recovery failures keep the entered values and stay on the step.
      const nextMessage = mode === "recovery"
        ? backendProvidedError(err, t("auth.error.generic"))
        : userFacingError(
            err,
            mode === "complete-phone" ? t("auth.error.completePhone") : t("auth.error.generic"),
          );
      notify("error", t("auth.toast.unable"), nextMessage);
    } finally {
      submissionGuard.current.release();
      if (mountedRef.current) setLoading(false);
    }
  };

  const otpTargetEmail =
    pendingOtpTarget && typeof pendingOtpTarget === "object" ? pendingOtpTarget.email : null;

  const resendOtp = async () => {
    // The backend's resend is keyed by email; a phone sign-in has none to send.
    if (!pendingOtpTarget || !otpTargetEmail) return;
    setResending(true);
    setMessage(null);
    try {
      const payload = await authService.resendOtp(pendingOtpTarget);
      notify("success", t("auth.toast.codeSent"), getMessage(payload, t("auth.otp.resent")));
    } catch (err) {
      notify("error", t("auth.toast.resendFailed"), userFacingError(err, t("auth.error.resend")));
    } finally {
      setResending(false);
    }
  };

  /** Recovery resend: asks again for the same address, within the same attempt. */
  const resendRecoveryCode = async () => {
    const codeEmail = recovery.email;
    if (!codeEmail || resending || loading) return;
    if (!submissionGuard.current.tryAcquire()) return;
    const attempt = recoveryAttempts.current.current();
    setResending(true);
    setMessage(null);
    try {
      await authService.forgotPassword({ email: codeEmail });
      if (!isRecoveryCurrent(attempt)) return;
      toast.showToast({ variant: "success", title: t("auth.toast.codeSent"), message: t("auth.code.detail", { email: codeEmail }) });
    } catch (err) {
      if (!isRecoveryCurrent(attempt)) return;
      notify("error", t("auth.toast.resendFailed"), backendProvidedError(err, t("auth.error.resend")));
    } finally {
      submissionGuard.current.release();
      if (mountedRef.current) setResending(false);
    }
  };

  const switchMode = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setMessage(null);
    setOtp("");
    setPendingOtpTarget(null);
  };

  const changeLoginMethod = (method: IdentifierMethod) => {
    if (loading) return;
    setLoginMethod(method);
    setMessage(null);
  };

  const cancelPhoneCompletion = () => {
    setPassword("");
    setCompletionPhone(createEmptyPhoneValue());
    setMessage(null);
    setMode("login");
  };

  const clearRecoveryDrafts = () => {
    setAddedEmail("");
    setRecoveryCode("");
    setRecoveryPassword("");
    setRecoveryPasswordConfirmation("");
    setShowRecoveryPassword(false);
    setShowRecoveryPasswordConfirmation(false);
  };

  /** Leaves recovery: a new attempt, so nothing in flight can act on it. */
  const resetRecovery = () => {
    dispatchRecovery({ type: "reset", attempt: recoveryAttempts.current.next() });
    setRecoveryEmail("");
    setRecoveryPhone(createEmptyPhoneValue());
    clearRecoveryDrafts();
    setMode("login");
    setMessage(null);
  };

  /** Starts recovery with the sign-in method and identifier already entered. */
  const startRecovery = () => {
    dispatchRecovery({ type: "start", attempt: recoveryAttempts.current.next(), method: loginMethod });
    setRecoveryEmail(email.trim());
    setRecoveryPhone(loginPhone);
    clearRecoveryDrafts();
    setMessage(null);
    setMode("recovery");
  };

  const changeRecoveryMethod = (method: RecoveryMethod) => {
    if (loading || method === recovery.method) return;
    dispatchRecovery({ type: "method", attempt: recoveryAttempts.current.next(), method });
    clearRecoveryDrafts();
    setMessage(null);
  };

  const editRecoveryEmail = (value: string) => {
    setRecoveryEmail(value);
    dispatchRecovery({ type: "identifierEdited", attempt: recoveryAttempts.current.next() });
    setMessage(null);
  };

  const editRecoveryPhone = (value: PhoneValue) => {
    setRecoveryPhone(value);
    dispatchRecovery({ type: "identifierEdited", attempt: recoveryAttempts.current.next() });
    setMessage(null);
  };

  const goBack = () => {
    if (mode === "complete-phone") return cancelPhoneCompletion();
    if (mode === "recovery") {
      if (recovery.step === "identify") return resetRecovery();
      // v3: new password → code; code / add email → the method step (a new
      // attempt: the code already sent no longer belongs to the flow).
      if (recovery.step === "newPassword") {
        setRecoveryPassword("");
        setRecoveryPasswordConfirmation("");
      } else {
        clearRecoveryDrafts();
      }
      dispatchRecovery({ type: "back", attempt: recoveryAttempts.current.next() });
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

  const identifierOptions = [
    { key: "email" as const, label: t("auth.identifier.email") },
    { key: "phone" as const, label: t("auth.identifier.phone") },
  ];

  // v3 copy per state. Every state is backed by an existing or verified
  // backend call; nothing here changes what is sent.
  const step = mode === "recovery" ? recovery.step : null;
  const title =
    mode === "login" ? t("auth.login.title")
      : mode === "register" ? t("auth.register.title")
        : mode === "complete-phone" ? t("auth.completePhone.title")
          : mode === "otp" ? t("auth.otp.title")
            : step === "identify" ? t("auth.forgot.title")
              : step === "addEmail" ? t("auth.addEmail.title")
                : step === "code" ? t("auth.code.title")
                  : t("auth.newPassword.title");
  const detail =
    mode === "login" ? t("auth.login.detail")
      : mode === "register" ? null
        : mode === "complete-phone" ? t("auth.completePhone.detail")
          : mode === "otp" ? t("auth.otp.detail")
            : step === "identify" ? t("auth.forgot.detail")
              : step === "addEmail" ? t("auth.addEmail.detail", { phone: recovery.phone ? formatBackendPhoneForDisplay(recovery.phone) : "" })
                : step === "code" ? t("auth.code.detail", { email: recovery.email ?? "" })
                  : t("auth.newPassword.detail");
  const primaryLabel = loading
    ? t("auth.action.wait")
    : mode === "login" ? t("auth.action.signIn")
      : mode === "register" ? t("auth.action.createAccount")
        : mode === "complete-phone" ? t("auth.action.continue")
          : mode === "otp" || step === "code" ? t("auth.action.verify")
            : step === "newPassword" ? t("auth.action.resetPassword")
              : t("auth.action.sendCode");
  const primaryDisabled =
    loading || (mode === "recovery" && resending) ||
    (mode === "login" &&
      (!password || (loginMethod === "email" ? !email.trim() : loginPhone.validation !== "valid"))) ||
    (mode === "register" &&
      (!name.trim() || !password || !passwordConfirmation || registrationPhone.validation !== "valid")) ||
    (mode === "complete-phone" && completionPhone.validation !== "valid") ||
    (mode === "otp" && (!pendingOtpTarget || otp.length !== 6)) ||
    (step === "identify" &&
      (recovery.method === "email" ? !recoveryEmail.trim() : recoveryPhone.validation !== "valid")) ||
    (step === "addEmail" && !addedEmail.trim()) ||
    (step === "code" && recoveryCode.length !== 6) ||
    (step === "newPassword" && (!recoveryPassword || !recoveryPasswordConfirmation));
  const showsLogo = mode === "login";
  const showsMailIcon = mode === "otp" || step === "addEmail" || step === "code";
  const backLabel =
    mode === "register" || step === "identify" ? t("auth.back.signIn") : t("auth.back.generic");

  return (
    <View style={[local.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView style={local.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <FlowHeader title="" backLabel={backLabel} onBack={goBack} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={local.scrollContent}
          >
            <Animated.View
              // Keyed by state so each v3 screen enters on its own.
              key={step ?? mode}
              entering={reduceMotion ? undefined : FadeInDown.duration(280)}
              style={local.panel}
            >
              {showsLogo ? (
                <Image
                  source={require("../../assets/images/lfa-logo.png")}
                  style={local.logo}
                  resizeMode="contain"
                  accessibilityLabel={t("auth.logo")}
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
                {mode === "login" || step === "identify" ? (
                  <SegmentedControl
                    role="radio"
                    accessibilityLabel={mode === "login" ? t("auth.identifier.label") : t("auth.identifier.recoveryLabel")}
                    options={identifierOptions}
                    value={mode === "login" ? loginMethod : recovery.method}
                    onChange={mode === "login" ? changeLoginMethod : changeRecoveryMethod}
                  />
                ) : null}

                {mode === "login" ? (
                  <>
                    {loginMethod === "email" ? (
                      <Field
                        label={t("auth.field.email")}
                        placeholder={t("auth.field.emailPlaceholder")}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="emailAddress"
                        autoComplete="email"
                        editable={!loading}
                      />
                    ) : (
                      <InternationalPhoneInput
                        label={t("auth.field.mobile")}
                        value={loginPhone}
                        disabled={loading}
                        error={phoneError(loginPhone, t("auth.error.phone"))}
                        onChange={setLoginPhone}
                      />
                    )}
                    <PasswordField
                      label={t("auth.field.password")}
                      value={password}
                      onChangeText={setPassword}
                      visible={showPassword}
                      onToggle={() => setShowPassword((value) => !value)}
                      editable={!loading}
                    />
                  </>
                ) : mode === "register" ? (
                  <>
                    <Field
                      label={t("auth.field.fullName")}
                      placeholder={t("auth.field.fullNamePlaceholder")}
                      value={name}
                      onChangeText={setName}
                      autoCapitalize="words"
                      textContentType="name"
                      editable={!loading}
                    />
                    <Field
                      label={t("auth.field.emailOptional")}
                      placeholder={t("auth.field.emailPlaceholder")}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="emailAddress"
                      autoComplete="email"
                      editable={!loading}
                    />
                    <InternationalPhoneInput
                      label={t("auth.field.mobile")}
                      value={registrationPhone}
                      disabled={loading}
                      error={phoneError(registrationPhone, t("auth.error.phone"))}
                      onChange={setRegistrationPhone}
                    />
                    <PasswordField
                      label={t("auth.field.password")}
                      placeholder={t("auth.field.passwordPlaceholder")}
                      value={password}
                      onChangeText={setPassword}
                      visible={showPassword}
                      onToggle={() => setShowPassword((value) => !value)}
                      editable={!loading}
                      newPassword
                    />
                    <PasswordField
                      label={t("auth.field.confirmPassword")}
                      value={passwordConfirmation}
                      onChangeText={setPasswordConfirmation}
                      visible={showPasswordConfirmation}
                      onToggle={() => setShowPasswordConfirmation((value) => !value)}
                      editable={!loading}
                      newPassword
                    />
                  </>
                ) : mode === "complete-phone" ? (
                  <InternationalPhoneInput
                    value={completionPhone}
                    disabled={loading}
                    error={phoneError(completionPhone, t("auth.error.phone"))}
                    onChange={setCompletionPhone}
                  />
                ) : mode === "otp" ? (
                  <OtpCodeInput
                    label={t("auth.field.code")}
                    value={otp}
                    onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
                    editable={!loading}
                    autoFocus
                  />
                ) : step === "identify" ? (
                  recovery.method === "email" ? (
                    <Field
                      label={t("auth.field.email")}
                      placeholder={t("auth.field.emailPlaceholder")}
                      value={recoveryEmail}
                      onChangeText={editRecoveryEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="emailAddress"
                      autoComplete="email"
                      editable={!loading}
                    />
                  ) : (
                    <InternationalPhoneInput
                      label={t("auth.field.mobile")}
                      value={recoveryPhone}
                      disabled={loading}
                      error={phoneError(recoveryPhone, t("auth.error.phone"))}
                      onChange={editRecoveryPhone}
                    />
                  )
                ) : step === "addEmail" ? (
                  <Field
                    label={t("auth.field.email")}
                    placeholder={t("auth.field.emailPlaceholder")}
                    value={addedEmail}
                    onChangeText={setAddedEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="emailAddress"
                    autoComplete="email"
                    editable={!loading}
                  />
                ) : step === "code" ? (
                  <>
                    <OtpCodeInput
                      label={t("auth.field.code")}
                      value={recoveryCode}
                      onChangeText={(value) =>
                        setRecoveryCode(value.replace(/\D/g, "").slice(0, 6))
                      }
                      editable={!loading}
                      autoFocus
                    />
                    <View style={local.resendRow}>
                      <AppText variant="meta" tone="muted">{t("auth.code.resendPrompt")}</AppText>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("auth.action.resend")}
                        aria-disabled={resending || loading}
                        aria-busy={resending}
                        disabled={resending || loading}
                        onPress={resendRecoveryCode}
                        hitSlop={8}
                        style={local.inlineLink}
                      >
                        <AppText variant="meta" style={{ color: theme.colors.brandInk, opacity: resending || loading ? 0.5 : 1 }}>
                          {resending ? t("auth.action.resending") : t("auth.action.resend")}
                        </AppText>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <PasswordField
                      label={t("auth.field.newPassword")}
                      placeholder={t("auth.field.passwordPlaceholder")}
                      value={recoveryPassword}
                      onChangeText={setRecoveryPassword}
                      visible={showRecoveryPassword}
                      onToggle={() => setShowRecoveryPassword((value) => !value)}
                      editable={!loading}
                      newPassword
                    />
                    <PasswordField
                      label={t("auth.field.confirmNewPassword")}
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
                      accessibilityLabel={t("auth.remember")}
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
                      <AppText variant="meta">{t("auth.remember")}</AppText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("auth.forgotLink")}
                      aria-disabled={loading}
                      onPress={startRecovery}
                      disabled={loading}
                      hitSlop={8}
                      style={local.linkButton}
                    >
                      <AppText variant="meta" style={{ color: theme.colors.brandInk }}>{t("auth.forgotLink")}</AppText>
                    </Pressable>
                  </View>
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
              <Button title={t("auth.action.createAccount")} variant="tonal" onPress={() => switchMode("register")} />
            ) : mode === "register" || mode === "otp" ? (
              <Button title={mode === "otp" ? t("auth.action.backToSignIn") : t("auth.action.haveAccount")} variant="ghost" onPress={() => switchMode("login")} />
            ) : mode === "complete-phone" ? (
              <Button title={t("auth.action.backToSignIn")} variant="ghost" onPress={cancelPhoneCompletion} disabled={loading} />
            ) : null}
            {mode === "otp" && otpTargetEmail ? (
              <Button
                title={resending ? t("auth.action.resending") : t("auth.action.resend")}
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
function Field({ label, ...inputProps }: FieldProps) {
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
  const i18n = useI18n();
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
          accessibilityLabel={i18n.t(visible ? "auth.field.hide" : "auth.field.show", { label })}
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
  passwordField: { minHeight: 52, borderRadius: 12, flexDirection: "row" as const, alignItems: "center" as const },
  passwordInput: { flex: 1, minHeight: 50, paddingHorizontal: 14, fontSize: 17 },
  visibilityButton: { width: 48, height: 48, alignItems: "center" as const, justifyContent: "center" as const },
  loginRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 8 },
  rememberRow: { minHeight: 44, flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingEnd: 12 },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderRadius: 6, alignItems: "center" as const, justifyContent: "center" as const },
  checkmark: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" as const },
  linkButton: { minHeight: 44, justifyContent: "center" as const, paddingStart: 12 },
  // v3 "Didn't get it? …" line under the code.
  resendRow: { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: 4, paddingHorizontal: 4 },
  inlineLink: { minHeight: 44, justifyContent: "center" as const },
  note: { paddingHorizontal: 4, fontWeight: "400" as const },
  // v3 bottom actions: 52pt primary, secondary below (the keyboard lifts them).
  actions: { width: "100%" as const, maxWidth: 520, alignSelf: "center" as const, gap: 10, paddingTop: 12, paddingBottom: 10 },
};
