import { withAuthRequired } from "@/components/withAuthRequired";
import { AppHeader } from "@/components/AppHeader";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import { Screen, useResponsive, useTheme } from "@/components/ui";
import { userFacingError } from "@/lib/userFacingError";
import { legalService } from "@/services/legal";
import { SymbolView } from "expo-symbols";
import { Stack } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

function AboutScreen() {
  const theme = useTheme();
  const responsive = useResponsive();
  const [visible, setVisible] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setVisible(true);
    if (content || loading) return;
    setLoading(true);
    setError(null);
    try {
      setContent(await legalService.privacyPolicy());
    } catch (err) {
      setError(
        userFacingError(
          err,
          "Could not load the privacy policy. Please try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <Screen>
      <Stack.Screen options={{ title: "About LFA Tickets" }} />
      <View style={[styles.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="About LFA Tickets" />
        <View
          style={[
            styles.group,
            {
              backgroundColor: theme.colors.panel,
              borderColor: theme.colors.line,
            },
          ]}
        >
          <Row
            title="Privacy Policy"
            icon={{
              ios: "hand.raised",
              android: "privacy_tip",
              web: "privacy_tip",
            }}
            onPress={() => void open()}
          />
          <Row
            title="Terms of Use"
            icon={{
              ios: "doc.text",
              android: "description",
              web: "description",
            }}
            onPress={() => setTermsVisible(true)}
          />
          {/* <Row
            title="FAQ"
            icon={{ ios: "questionmark.circle", android: "help", web: "help" }}
            disabled
          /> */}
        </View>
      </View>
      <BottomSheetModal visible={visible} onClose={() => setVisible(false)} title="Privacy Policy" wide>
            <ScrollView contentContainerStyle={styles.policy}>
              {loading ? (
                <ActivityIndicator color={theme.colors.primary} />
              ) : null}
              {error ? (
                <Text style={{ color: theme.colors.danger }}>{error}</Text>
              ) : null}
              {content ? (
                <Text
                  selectable
                  style={[styles.body, { color: theme.colors.secondary }]}
                >
                  {content}
                </Text>
              ) : null}
            </ScrollView>
      </BottomSheetModal>
      <BottomSheetModal
        visible={termsVisible}
        onClose={() => setTermsVisible(false)}
        title="Terms of Use"
        wide
      >
        <ScrollView contentContainerStyle={styles.policy}>
          <Text style={[styles.body, { color: theme.colors.secondary }]}>
            Terms of Use will be available soon.
          </Text>
        </ScrollView>
      </BottomSheetModal>
    </Screen>
  );
}
function Row({
  title,
  icon,
  onPress,
  disabled,
}: {
  title: string;
  icon: any;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.colors.line },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: theme.colors.panelSoft }]}>
        <SymbolView
          name={icon}
          size={20}
          tintColor={theme.colors.primary}
          fallback={<Text>{title[0]}</Text>}
        />
      </View>
      <Text style={[styles.rowText, { color: theme.colors.ink }]}>{title}</Text>
      {disabled ? (
        <Text style={{ color: theme.colors.muted }}>Unavailable</Text>
      ) : (
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={20} tintColor={theme.colors.muted} fallback={<View />} />
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  shell: { flex: 1, alignSelf: "center" },
  group: { marginTop: 8, borderWidth: 1, borderRadius: 19, overflow: "hidden" },
  row: {
    minHeight: 68,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.7 },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 12,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    opacity: 0.4,
    alignSelf: "center",
  },
  title: { fontSize: 22, fontWeight: "900" },
  policy: { paddingVertical: 10 },
  body: { fontSize: 15, lineHeight: 24 },
});

export default withAuthRequired(AboutScreen);
