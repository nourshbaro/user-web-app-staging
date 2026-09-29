import { AppHeader } from "@/components/AppHeader";
import { AppText, SectionHeader } from "@/components/foundation";
import { Button, useResponsive, useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useAuth } from "@/context/AuthContext";
import { useTicketHolders } from "@/context/TicketHoldersContext";
import { useI18n } from "@/i18n/I18nProvider";
import {
  groupHolderSlots,
  holderCompleteness,
  isHolderNameValid,
} from "@/lib/checkoutFlow";
import { radius, size, spacing } from "@/lib/designTokens";
import type { TicketSlot } from "@/lib/ticketHolders";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
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
 * Ticket-holder names, one field per ticket, grouped by match and zone.
 * Names are owned by `TicketHoldersContext`; this screen only edits them.
 * The rule is unchanged: every ticket needs a non-blank holder name before
 * Checkout (which also re-checks and sends them as `tickets_by_match`).
 */
function TicketHoldersScreen() {
  const { ticketSlots, holderNames, setHolderName, initializeFirstHolder } = useTicketHolders();
  const auth = useAuth();
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

  const returnToParent = useCallback(() => {
    if (isEditMode) {
      router.dismissTo("/checkout");
      return;
    }
    router.replace("/cart");
  }, [isEditMode]);

  useEffect(() => {
    if (!ticketSlots.length) router.replace("/cart");
  }, [ticketSlots.length]);

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

  return (
    <View style={[local.screen, { backgroundColor: theme.colors.bg, paddingTop: Math.max(insets.top, 12) }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <KeyboardAvoidingView
        style={local.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <AppHeader
            title={isEditMode ? i18n.t("holders.editTitle") : i18n.t("holders.title")}
            hideCart
            showTimer
            onBack={returnToParent}
          />
          <ScrollView
            style={local.body}
            contentContainerStyle={local.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={local.intro}>
              <AppText variant="body" tone="muted">{i18n.t("holders.intro")}</AppText>
              <Progress complete={completeness.complete} total={completeness.total} />
            </View>

            {groups.map((group) => (
              <View key={group.matchId} style={local.group}>
                <SectionHeader title={group.matchTitle ?? i18n.t("cart.matchFallback", { id: group.matchId })} />
                {group.zones.map((zone) => (
                  <View key={zone.zoneName} style={local.zone}>
                    <AppText variant="label" tone="muted">{zone.zoneName}</AppText>
                    {zone.entries.map(({ slot, index }) => {
                      const nextKey = ticketSlots[index + 1]?.key;
                      return (
                        <HolderField
                          key={slot.key}
                          slot={slot}
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
                ))}
              </View>
            ))}
          </ScrollView>

          <View
            style={[
              local.footer,
              {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.border,
                paddingBottom: Math.max(insets.bottom, spacing.md),
              },
            ]}
          >
            {completeness.missingKeys.length ? (
              <AppText variant="caption" tone={showErrors ? "danger" : "muted"} accessibilityLiveRegion="polite">
                {i18n.plural("holders.missing", completeness.missingKeys.length)}
              </AppText>
            ) : null}
            <Button
              title={isEditMode ? i18n.t("holders.save") : i18n.t("holders.continue")}
              onPress={finish}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Progress({ complete, total }: { complete: number; total: number }) {
  const theme = useTheme();
  const i18n = useI18n();
  const ratio = total ? complete / total : 0;
  const label = i18n.t("holders.progress", { complete, total });
  return (
    <View
      style={local.progress}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: complete }}
    >
      <AppText variant="label">{label}</AppText>
      <View style={[local.track, { backgroundColor: theme.colors.surfaceSecondary }]}>
        <View
          style={[
            local.fill,
            { width: `${Math.round(ratio * 100)}%`, backgroundColor: theme.colors.tones.success.fg },
          ]}
        />
      </View>
    </View>
  );
}

function HolderField({
  slot,
  value,
  showError,
  isLast,
  inputRef,
  onChange,
  onBlur,
  onSubmit,
}: {
  slot: TicketSlot;
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
  const complete = isHolderNameValid(value);
  const danger = theme.colors.tones.danger;
  const success = theme.colors.tones.success;

  return (
    <View
      style={[
        local.field,
        {
          backgroundColor: theme.colors.surface,
          borderColor: showError ? danger.fg : theme.colors.border,
          borderWidth: showError ? 2 : 1,
        },
      ]}
    >
      <View style={local.fieldHeader}>
        <AppText variant="bodyStrong" numberOfLines={2} style={local.fieldTitle}>{slot.label}</AppText>
        {/* Status is text + icon, never colour alone. */}
        <View style={local.status}>
          <SymbolView
            name={(complete
              ? { ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }
              : { ios: "exclamationmark.circle", android: "error_outline", web: "error_outline" }) as never}
            size={size.iconSm}
            tintColor={complete ? success.fg : theme.colors.textMuted}
            fallback={<View />}
          />
          <AppText variant="caption" style={{ color: complete ? success.fg : theme.colors.textMuted }}>
            {complete ? i18n.t("holders.field.complete") : i18n.t("holders.field.needed")}
          </AppText>
        </View>
      </View>
      <AppText variant="label" tone="muted" nativeID={`${slot.key}-label`}>{i18n.t("holders.field.label")}</AppText>
      <View
        style={[
          local.inputSurface,
          { backgroundColor: theme.colors.surfaceSecondary, borderColor: showError ? danger.fg : theme.colors.border },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
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
  shell: { flex: 1, alignSelf: "center" as const, paddingHorizontal: spacing.md },
  body: { flex: 1 },
  bodyContent: {
    width: "100%" as const,
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: "center" as const,
    gap: spacing.xl,
    paddingBottom: spacing.xl,
  },
  intro: { gap: spacing.md },
  progress: { gap: spacing.xs },
  track: { height: 6, borderRadius: radius.pill, overflow: "hidden" as const },
  fill: { height: "100%" as const, borderRadius: radius.pill },
  group: { gap: spacing.md },
  zone: { gap: spacing.sm },
  field: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  fieldHeader: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  fieldTitle: { flex: 1, minWidth: 0 },
  status: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs, flexShrink: 0 },
  inputSurface: {
    minHeight: size.controlHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingStart: spacing.md,
  },
  input: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: spacing.md },
  clear: {
    width: size.touchTargetMin,
    height: size.touchTargetMin,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  error: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  footer: {
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    gap: spacing.sm,
  },
};

export default withAuthRequired(TicketHoldersScreen);
