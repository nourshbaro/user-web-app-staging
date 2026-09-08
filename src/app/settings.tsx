import { AccountDeletionModal } from "@/components/AccountDeletionModal";
import { AppHeader } from "@/components/AppHeader";
import { Screen, useResponsive, useTheme } from "@/components/ui";
import { withAuthRequired } from "@/components/withAuthRequired";
import { useToast } from "@/context/ToastContext";
import { useNotificationPermission } from "@/hooks/useNotificationPermission";
import { registerPushDevice } from "@/lib/registerPushDevice";
import type { ThemeMode } from "@/lib/themePalette";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

const APPEARANCE: {
  value: ThemeMode;
  label: string;
  icon: any;
}[] = [
  {
    value: "system",
    label: "System",
    icon: {
      ios: "circle.lefthalf.filled",
      android: "contrast",
      web: "contrast",
    },
  },
  {
    value: "light",
    label: "Light",
    icon: {
      ios: "sun.max",
      android: "light_mode",
      web: "light_mode",
    },
  },
  {
    value: "dark",
    label: "Dark",
    icon: {
      ios: "moon",
      android: "dark_mode",
      web: "dark_mode",
    },
  },
];

function SettingsScreen() {
  const toast = useToast();
  const responsive = useResponsive();
  const theme = useTheme();

  const [deleteVisible, setDeleteVisible] = useState(false);

  const {
    status: pushPermission,
    loading: pushPermissionLoading,
    openSettings,
  } = useNotificationPermission();

  const pushGranted = pushPermission === "granted";
  const pushDenied = pushPermission === "denied";

  const pushDetail = pushPermissionLoading
    ? "Checking permission..."
    : pushGranted
      ? "Allowed on this device"
      : pushDenied
        ? "Enable notifications in device settings"
        : "Allow notifications from LFA";

  useEffect(() => {
    if (pushGranted) void registerPushDevice().catch(() => {});
  }, [pushGranted]);

  const handlePushPress = async () => {
    if (pushPermissionLoading) return;
    try {
      await openSettings();
    } catch {
      toast.showToast({
        variant: "error",
        title: "Could not open settings",
        message:
          "Open your device settings and select LFA to change notification permission.",
      });
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: "Settings" }} />

      <View style={[styles.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="Settings" />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Section title="Notifications">
            <SettingRow
              title="Push Notifications"
              detail={pushDetail}
              icon={{
                ios: "bell",
                android: "notifications",
                web: "notifications",
              }}
              onPress={handlePushPress}
              trailing={
                <Switch
                  trackColor={{
                    false: theme.colors.muted,
                    true: theme.colors.primary,
                  }}
                  thumbColor={
                    theme.isDark ? theme.colors.ink : theme.colors.panel
                  }
                  ios_backgroundColor={theme.colors.muted}
                  value={pushGranted}
                  disabled={pushPermissionLoading}
                  accessibilityLabel="Push Notifications permission"
                  accessibilityState={{
                    checked: pushGranted,
                    disabled: pushPermissionLoading,
                  }}
                  onValueChange={() => {
                    void handlePushPress();
                  }}
                />
              }
            />

            <Divider />

            <SettingRow
              title="Email Notifications"
              detail="Not available yet"
              icon={{
                ios: "envelope",
                android: "mail",
                web: "mail",
              }}
              trailing={
                <Switch
                  trackColor={{
                    false: theme.colors.muted,
                    true: theme.colors.primary,
                  }}
                  thumbColor={
                    theme.isDark ? theme.colors.ink : theme.colors.panel
                  }
                  ios_backgroundColor={theme.colors.muted}
                  value={false}
                  disabled
                  accessibilityLabel="Email Notifications unavailable"
                />
              }
            />
          </Section>

          <Section title="Preferences">
            <SettingRow
              title="Language"
              detail="English"
              icon={{
                ios: "globe",
                android: "language",
                web: "language",
              }}
              trailing={
                <View
                  style={[
                    styles.languageBadge,
                    { backgroundColor: theme.colors.primary },
                  ]}
                >
                  <Text style={styles.languageText}>EN</Text>
                </View>
              }
            />

            <Divider />

            <View style={styles.appearanceHeader}>
              <View
                style={[
                  styles.icon,
                  { backgroundColor: theme.colors.panelSoft },
                ]}
              >
                <SymbolView
                  name={{
                    ios: "circle.lefthalf.filled",
                    android: "contrast",
                    web: "contrast",
                  }}
                  size={19}
                  tintColor={theme.colors.primary}
                  fallback={<Text>A</Text>}
                />
              </View>

              <View style={styles.copy}>
                <Text style={[styles.rowTitle, { color: theme.colors.ink }]}>
                  Appearance
                </Text>

                <Text style={theme.styles.muted}>Choose how the app looks</Text>
              </View>
            </View>

            <View accessibilityRole="radiogroup" style={styles.appearanceGrid}>
              {APPEARANCE.map((option) => {
                const selected = theme.mode === option.value;

                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label} appearance`}
                    onPress={() => theme.setMode(option.value)}
                    style={({ pressed }) => [
                      styles.appearanceOption,
                      {
                        borderColor: selected
                          ? theme.colors.primary
                          : theme.colors.line,
                        backgroundColor: selected
                          ? theme.colors.panelSoft
                          : theme.colors.panel,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <SymbolView
                      name={option.icon}
                      size={20}
                      tintColor={
                        selected ? theme.colors.primary : theme.colors.muted
                      }
                      fallback={<Text>{option.label[0]}</Text>}
                    />

                    <Text
                      style={{
                        color: selected
                          ? theme.colors.primary
                          : theme.colors.ink,
                        fontWeight: "800",
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>

          <Section title="Account">
            <SettingRow
              title="Delete Account"
              icon={{
                ios: "trash",
                android: "delete",
                web: "delete",
              }}
              destructive
              onPress={() => setDeleteVisible(true)}
            />
          </Section>
        </ScrollView>
      </View>

      <AccountDeletionModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
      />
    </Screen>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.colors.muted }]}>
        {title}
      </Text>

      <View
        style={[
          styles.group,
          {
            backgroundColor: theme.colors.panel,
            borderColor: theme.colors.line,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function Divider() {
  const theme = useTheme();

  return (
    <View style={[styles.divider, { backgroundColor: theme.colors.line }]} />
  );
}

function SettingRow({
  title,
  detail,
  icon,
  trailing,
  destructive,
  onPress,
}: {
  title: string;
  detail?: string;
  icon: any;
  trailing?: React.ReactNode;
  destructive?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();

  const content = (
    <>
      <View style={[styles.icon, { backgroundColor: theme.colors.panelSoft }]}>
        <SymbolView
          name={icon}
          size={19}
          tintColor={destructive ? theme.colors.danger : theme.colors.primary}
          fallback={<Text>{title[0]}</Text>}
        />
      </View>

      <View style={styles.copy}>
        <Text
          style={[
            styles.rowTitle,
            {
              color: destructive ? theme.colors.danger : theme.colors.ink,
            },
          ]}
        >
          {title}
        </Text>

        {detail ? <Text style={theme.styles.muted}>{detail}</Text> : null}
      </View>

      {trailing}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignSelf: "center",
  },

  content: {
    gap: 20,
    paddingTop: 8,
    paddingBottom: 30,
  },

  section: {
    gap: 9,
  },

  sectionTitle: {
    marginLeft: 4,
    fontSize: 13,
    fontWeight: "800",
  },

  group: {
    borderRadius: 19,
    borderWidth: 1,
    overflow: "hidden",
  },

  row: {
    minHeight: 70,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  copy: {
    flex: 1,
    gap: 2,
  },

  rowTitle: {
    fontSize: 16,
    fontWeight: "800",
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },

  languageBadge: {
    minWidth: 48,
    minHeight: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  languageText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },

  appearanceHeader: {
    minHeight: 70,
    paddingHorizontal: 14,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  appearanceGrid: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },

  appearanceOption: {
    flex: 1,
    minHeight: 66,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },

  pressed: {
    opacity: 0.72,
  },
});
export default withAuthRequired(SettingsScreen);
