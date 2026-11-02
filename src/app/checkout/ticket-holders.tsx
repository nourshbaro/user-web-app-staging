import { FlowHeader, StepBar } from "@/components/FlowHeader";
import { useReservationAnnouncements } from "@/components/cart/ReservationStatus";
import { AppText, KeyboardAwareView, TransactionBar } from "@/components/foundation";
import { useResponsive, useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useTicketHolders } from "@/context/TicketHoldersContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
  groupHolderSlots,
  holderCompleteness,
  isHolderNameValid,
} from "@/lib/checkoutFlow";
import { size, spacing } from "@/lib/designTokens";
import type { TicketSlot } from "@/lib/ticketHolders";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Readable single column on tablets and web.
const COLUMN_MAX_WIDTH = 640;

/**
 * v3 "Who's going?": one holder name per physical ticket, grouped by match.
 * Names are owned by `TicketHoldersContext`; this screen only edits them.
 * The rule is unchanged: every ticket needs a non-blank holder name before
 * Checkout (which also re-checks and sends them as `tickets_by_match`).
 */
function TicketHoldersScreen() {
  const { ticketSlots, holderNames, setHolderName, initializeFirstHolder } = useTicketHolders();
  const auth = useAuth();
  const cart = useCart();
  const theme = useTheme();
  const i18n = useI18n();
  const responsive = useResponsive();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ edit?: string | string[] }>();
  const isEditMode = firstParam(params.edit) === "1";
  const [showErrors, setShowErrors] = useState(false);
  const [touched, setTouched] = useState<Record<string, true>>({});
  const inputRefs = useRef(new Map<string, TextInput>());
  const completeness = holderCompleteness(ticketSlots, holderNames);
  const groups = groupHolderSlots(ticketSlots);
  // The visible countdown is the global read-only indicator; this keeps the
  // thresholded screen-reader warnings on this step.
  useReservationAnnouncements(cart.secondsLeft);

  const returnToParent = useCallback(() => {
    if (isEditMode) {
      router.dismissTo("/checkout");
      return;
    }
    router.replace("/cart");
  }, [isEditMode]);

  useEffect(() => {
    // After expiry the owner has already routed Home under its sheet.
    if (!ticketSlots.length && !cart.expiredHold) router.replace("/cart");
  }, [cart.expiredHold, ticketSlots.length]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      returnToParent();
      return true;
    });
    return () => subscription.remove();
  }, [returnToParent]);

  // The first holder is pre-filled once from the profile name (unchanged rule).
  useEffect(() => {
    const firstSlot = ticketSlots[0];
    const profileName = auth.user?.name?.trim();
    if (!isEditMode && firstSlot && profileName) initializeFirstHolder(firstSlot.key, profileName);
  }, [auth.user?.name, initializeFirstHolder, isEditMode, ticketSlots]);

  const focusSlot = (key: string | null | undefined) => {
    if (!key) return;
    requestAnimationFrame(() => inputRefs.current.get(key)?.focus());
  };

  const finish = () => {
    if (completeness.firstIncompleteKey) {
      setShowErrors(true);
      AccessibilityInfo.announceForAccessibility(
        i18n.plural("holders.missing", completeness.missingKeys.length),
      );
      focusSlot(completeness.firstIncompleteKey);
      return;
    }
    if (isEditMode) router.dismissTo("/checkout");
    else router.replace("/checkout");
  };

  if (!ticketSlots.length) return null;

  const columnWidth = Math.min(responsive.contentWidth, COLUMN_MAX_WIDTH);
  const ratio = completeness.total ? completeness.complete / completeness.total : 0;
  const progressLabel = i18n.t("holders.progress", { complete: completeness.complete, total: completeness.total });

  return (
    <View style={[local.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {/* Keeps the focused field and the footer above the keyboard. */}
      <KeyboardAwareView style={local.keyboardView}>
        <View style={[local.header, { width: responsive.contentWidth }]}>
          <FlowHeader
            title={isEditMode ? i18n.t("holders.editTitle") : i18n.t("holders.title")}
            backLabel={isEditMode ? i18n.t("flow.payment") : i18n.t("flow.cart")}
            onBack={returnToParent}
            // v3 holders: iOS shows no header title (the in-page heading is it); Android does.
            titleOnIos={false}
          />
        </View>
        <ScrollView
          style={local.body}
          contentContainerStyle={[local.bodyContent, { width: columnWidth }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <StepBar step={1} />
          <View style={local.intro}>
            <AppText variant="displayPrompt" accessibilityRole="header">{i18n.t("holders.prompt")}</AppText>
            <AppText variant="body" tone="muted">{i18n.t("holders.intro")}</AppText>
          </View>

          {groups.map((group) => (
            <View key={group.matchId} style={local.group}>
              <AppText variant="overline" tone="muted" accessibilityRole="header" numberOfLines={2}>
                {group.matchTitle ?? i18n.t("cart.matchFallback", { id: group.matchId })}
              </AppText>
              <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
                {group.zones.flatMap((zone) => zone.entries).map(({ slot, index }, row) => {
                  const nextKey = ticketSlots[index + 1]?.key;
                  return (
                    <HolderField
                      key={slot.key}
                      slot={slot}
                      number={index + 1}
                      first={row === 0}
                      value={holderNames[slot.key] ?? ""}
                      showError={(showErrors || Boolean(touched[slot.key])) && !isHolderNameValid(holderNames[slot.key])}
                      isLast={!nextKey}
                      inputRef={(input) => {
                        if (input) inputRefs.current.set(slot.key, input);
                        else inputRefs.current.delete(slot.key);
                      }}
                      onChange={(value) => setHolderName(slot.key, value)}
                      onBlur={() => setTouched((current) => (current[slot.key] ? current : { ...current, [slot.key]: true }))}
                      onSubmit={() => (nextKey ? focusSlot(nextKey) : finish())}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>

        <TransactionBar
          stacked
          leading={
            <View
              style={local.progress}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={progressLabel}
              accessibilityValue={{ min: 0, max: completeness.total, now: completeness.complete }}
            >
              <View style={[local.track, { backgroundColor: theme.colors.bgAlt }]}>
                <View
                  style={[
                    local.fill,
                    { width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.colors.tones.success.fg },
                  ]}
                />
              </View>
              <AppText variant="meta" tone={showErrors && completeness.missingKeys.length ? "danger" : "muted"} accessibilityLiveRegion="polite">
                {completeness.missingKeys.length && showErrors
                  ? i18n.plural("holders.missing", completeness.missingKeys.length)
                  : progressLabel}
              </AppText>
            </View>
          }
          primaryAction={{
            label: isEditMode ? i18n.t("holders.save") : i18n.t("holders.continue"),
            onPress: finish,
          }}
        />
      </KeyboardAwareView>
    </View>
  );
}

function HolderField({
  slot,
  number,
  first,
  value,
  showError,
  isLast,
  inputRef,
  onChange,
  onBlur,
  onSubmit,
}: {
  slot: TicketSlot;
  number: number;
  first: boolean;
  value: string;
  showError: boolean;
  isLast: boolean;
  inputRef: (input: TextInput | null) => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const [focused, setFocused] = useState(false);
  const complete = isHolderNameValid(value);
  const danger = theme.colors.tones.danger;
  const success = theme.colors.tones.success;
  // v3: inset hairline at rest, a 2pt brand ring while focused; errors also say so in text.
  const ringColor = showError ? danger.fg : focused ? theme.colors.actionPrimary : theme.colors.border;

  return (
    <View style={[local.field, !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]}>
      <View style={local.fieldHeader}>
        <AppText variant="bodyStrong" style={local.fieldTitle}>{i18n.t("holders.ticketNumber", { number })}</AppText>
        <AppText variant="meta" tone="muted" numberOfLines={2} style={local.fieldDesc}>{slot.label}</AppText>
      </View>
      <View
        style={[
          local.inputSurface,
          {
            backgroundColor: theme.colors.surfaceSecondary,
            borderColor: ringColor,
            borderWidth: showError || focused ? 2 : 1,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur();
          }}
          placeholder={i18n.t("holders.field.placeholder")}
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="name"
          textContentType="name"
          returnKeyType={isLast ? "done" : "next"}
          submitBehavior={isLast ? "blurAndSubmit" : "submit"}
          onSubmitEditing={onSubmit}
          accessibilityLabel={i18n.t("holders.field.a11y", { ticket: slot.label })}
          accessibilityHint={showError ? i18n.t("holders.field.error") : undefined}
          aria-invalid={showError}
          style={[local.input, { color: theme.colors.textStrong }]}
        />
        {complete ? (
          // v3 green check badge; "Named" is also exposed as text for assistive tech.
          <View
            style={[local.check, { backgroundColor: success.fg }]}
            accessible
            accessibilityLabel={i18n.t("holders.field.complete")}
          >
            <SymbolView
              name={{ ios: "checkmark", android: "check", web: "check" }}
              size={13}
              tintColor="#FFFFFF"
              fallback={<AppText variant="caption" style={{ color: "#FFFFFF" }}>✓</AppText>}
            />
          </View>
        ) : null}
        {value ? (
          <Pressable
            onPress={() => onChange("")}
            accessibilityRole="button"
            accessibilityLabel={i18n.t("holders.clear", { ticket: slot.label })}
            style={local.clear}
          >
            <SymbolView
              name={{ ios: "xmark.circle.fill", android: "cancel", web: "cancel" }}
              size={size.iconMd}
              tintColor={theme.colors.textMuted}
              fallback={<View />}
            />
          </Pressable>
        ) : null}
      </View>
      {showError ? (
        <View style={local.error}>
          <SymbolView
            name={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" } as never}
            size={size.iconSm}
            tintColor={danger.fg}
            fallback={<View />}
          />
          <AppText variant="caption" tone="danger">{i18n.t("holders.field.error")}</AppText>
        </View>
      ) : null}
    </View>
  );
}

const local = {
  screen: { flex: 1, alignItems: "center" as const },
  keyboardView: { flex: 1, width: "100%" as const, alignItems: "center" as const },
  header: { alignSelf: "center" as const },
  body: { flex: 1, width: "100%" as const },
  bodyContent: {
    alignSelf: "center" as const,
    gap: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  intro: { gap: spacing.sm },
  progress: { gap: 6 },
  track: { height: 4, borderRadius: 2, overflow: "hidden" as const },
  fill: { height: "100%" as const, borderRadius: 2 },
  group: { gap: spacing.sm },
  card: { borderRadius: 20, overflow: "hidden" as const },
  field: { paddingHorizontal: spacing.lg, paddingVertical: 14, gap: 10 },
  fieldHeader: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: spacing.sm, flexWrap: "wrap" as const },
  fieldTitle: {},
  fieldDesc: { flex: 1, minWidth: 0, fontWeight: "500" as const },
  // v3: 48pt input, radius 12, 17pt text.
  inputSurface: {
    minHeight: size.touchTarget,
    borderRadius: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingStart: spacing.md,
  },
  input: { flex: 1, minWidth: 0, fontSize: 17, paddingVertical: spacing.sm },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginStart: spacing.xs,
  },
  clear: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  error: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
};

export default withAuthRequired(TicketHoldersScreen);
