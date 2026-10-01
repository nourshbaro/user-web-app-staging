import { AccountDeletionModal } from "@/components/AccountDeletionModal";
import { SubpageShell } from "@/components/SubpageShell";
import { AppText, SegmentedControl } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useToast } from "@/context/ToastContext";
import { useNotificationPermission } from "@/hooks/useNotificationPermission";
import { useI18n } from "@/i18n/I18nProvider";
import { spacing } from "@/lib/designTokens";
import { registerPushDevice } from "@/lib/registerPushDevice";
import { pushRuntimeSupported } from "@/lib/notifications";
import { pushSettingsSupported, settingsPushState } from "@/lib/settingsPresentation";
import type { ThemeMode } from "@/lib/themePalette";
import { SymbolView } from "expo-symbols";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";

const APPEARANCE: readonly ThemeMode[] = ["system", "light", "dark"];

/**
 * Settings (LFA Screen v3). Only real capabilities are offered:
 * - push notifications: the OS permission, read live; the only action opens
 *   the phone's settings (no in-app switch pretends to persist a preference);
 * - appearance: the app theme mode (`ThemeProvider`);
 * - language: shown, not switchable — English is the only complete catalog;
 * - account deletion: the existing `AccountDeletionModal`.
 */
function SettingsScreen() {
  const toast = useToast();
  const theme = useTheme();
  const i18n = useI18n();
  const [deleteVisible, setDeleteVisible] = useState(false);
  const { status: pushPermission, loading: pushPermissionLoading, openSettings } = useNotificationPermission();
  const push = settingsPushState(pushPermission, pushPermissionLoading, pushSettingsSupported(Platform.OS, pushRuntimeSupported));

  // A permission granted in the phone's settings registers exactly as before.
  useEffect(() => {
    if (pushPermission === "granted") void registerPushDevice().catch(() => {});
  }, [pushPermission]);

  const handlePushPress = async () => {
    if (pushPermissionLoading) return;
    try {
      await openSettings();
    } catch {
      toast.showToast({
        variant: "error",
        title: "Could not open settings",
        message: "Open your device settings and select LFA to change notification permission.",
      });
    }
  };

  return (
    <SubpageShell title={i18n.t("settings.title")} backLabel={i18n.t("profile.title")} fallback="/profile">
      <Section title={i18n.t("settings.notifications")}>
        <View style={[local.card, local.pushCard, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
          <View style={local.pushRow} accessible accessibilityLabel={`${i18n.t("settings.push")}: ${i18n.t(`settings.push.${push.state}`)}`}>
            <AppText variant="body" style={local.rowLabel}>{i18n.t("settings.push")}</AppText>
            <AppText variant="body" tone={push.state === "on" ? "strong" : "muted"}>{i18n.t(`settings.push.${push.state}`)}</AppText>
          </View>
          <AppText variant="meta" tone="muted" style={local.regular}>{i18n.t(`settings.push.${push.state}.detail`)}</AppText>
          {push.actionable ? (
            <Pressable
              onPress={() => void handlePushPress()}
              disabled={pushPermissionLoading}
              accessibilityRole="button"
              accessibilityLabel={i18n.t("settings.push.open")}
              aria-disabled={pushPermissionLoading}
              style={({ pressed }) => [local.pushButton, { backgroundColor: theme.colors.tones.brand.bg }, (pressed || pushPermissionLoading) && { opacity: 0.7 }]}
            >
              <AppText variant="meta" style={{ color: theme.colors.brandInk, fontWeight: "600" }}>{i18n.t("settings.push.open")}</AppText>
            </Pressable>
          ) : null}
        </View>
      </Section>

      <Section title={i18n.t("settings.appearance")}>
        <SegmentedControl
          role="radio"
          options={APPEARANCE.map((mode) => ({ key: mode, label: i18n.t(`settings.appearance.${mode}`) }))}
          value={theme.mode}
          onChange={(mode) => theme.setMode(mode)}
          accessibilityLabel={i18n.t("settings.appearance")}
        />
      </Section>

      <Section title={i18n.t("settings.language")}>
        {/* Display only: English is the only complete catalog, so there is nothing to switch to. */}
        <View
          style={[local.card, local.languageRow, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}
          accessible
          accessibilityLabel={i18n.t("settings.language.a11y", { language: i18n.meta.nativeName })}
        >
          <SymbolView name={{ ios: "globe", android: "language", web: "language" }} size={20} tintColor={theme.colors.textMuted} fallback={<View />} />
          <AppText variant="body" style={local.rowLabel}>{i18n.meta.nativeName}</AppText>
          <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={18} tintColor={theme.colors.actionPrimary} fallback={<View />} />
        </View>
      </Section>

      <Section title={i18n.t("settings.account")}>
        <Pressable
          onPress={() => setDeleteVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={i18n.t("settings.deleteAccount")}
          style={({ pressed }) => [local.card, local.deleteRow, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }, pressed && { opacity: 0.85 }]}
        >
          <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={20} tintColor={theme.colors.brandInk} fallback={<View />} />
          <AppText variant="body" style={{ color: theme.colors.brandInk }}>{i18n.t("settings.deleteAccount")}</AppText>
        </Pressable>
      </Section>

      <AccountDeletionModal visible={deleteVisible} onClose={() => setDeleteVisible(false)} />
    </SubpageShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={local.section}>
      <AppText variant="overline" tone="muted" accessibilityRole="header" style={local.sectionTitle}>{title}</AppText>
      {children}
    </View>
  );
}

const local = {
  section: { gap: spacing.sm },
  sectionTitle: { paddingHorizontal: spacing.xs, paddingTop: spacing.sm },
  card: { borderRadius: 20 },
  pushCard: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  pushRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, gap: spacing.md },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: "500" as const },
  regular: { fontWeight: "400" as const },
  // v3: 36pt pill button; grown to the 44pt target.
  pushButton: { alignSelf: "flex-start" as const, minHeight: 44, paddingHorizontal: 14, borderRadius: 10, justifyContent: "center" as const },
  languageRow: { minHeight: 52, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  deleteRow: { minHeight: 52, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
};

export default withAuthRequired(SettingsScreen);
