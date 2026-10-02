import { AppText } from "@/components/foundation";
import { SystemLogoTile } from "@/components/maintenance/SystemLogoTile";
import { Button, useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { updatePromptCopy, validStoreUrl } from "@/lib/appUpdatePolicy";
import { fontStyleFor } from "@/lib/fontFamilies";
import { currentAppPlatform } from "@/services/appUpdate";
import { useEffect, useState } from "react";
import { Animated, Easing, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** v3 `--dlgR`: 16 on iOS, 28 on Android. */
const DIALOG_RADIUS = Platform.OS === "android" ? 28 : 16;
/** v3 `lfFade .25s` (scrim) and `lfDialog .3s cubic-bezier(.22,1,.36,1)` (card: scale 1.08 → 1, fade in). */
const FADE_MS = 250;
const DIALOG_MS = 300;
const DIALOG_FROM_SCALE = 1.08;
const NATIVE_DRIVER = Platform.OS !== "web";

export type UpdatePromptDialogProps = {
  kind: "required" | "available";
  /** The validated official store listing from the policy; null only in the development preview. */
  storeUrl: string | null;
  latestVersion: string | null;
  releaseNotes: readonly string[];
  /** Optional update only: "Not now". A required update has no dismissal. */
  onDismiss?: () => void;
};

/**
 * LFA Screen v3 `update_available` / `update_required`. A required update is
 * a blocker: no "Not now", the scrim does not dismiss, and Android Back is
 * swallowed. Opening the store never clears it (only a newer installed
 * version does). An optional update is dismissed only by "Not now" (or Back,
 * the same action); the scrim does not dismiss it (v3).
 */
export function UpdatePromptDialog({ kind, storeUrl, latestVersion, releaseNotes, onDismiss }: UpdatePromptDialogProps) {
  const theme = useTheme();
  const { t, meta } = useI18n();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [openFailed, setOpenFailed] = useState(false);
  const [scrim] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [card] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const copy = updatePromptCopy(kind, { latestVersion, releaseNotes });
  const latin = meta.script === "latin";
  const dismissible = kind === "available" && Boolean(onDismiss);

  useEffect(() => {
    if (reducedMotion) {
      scrim.setValue(1);
      card.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(scrim, { toValue: 1, duration: FADE_MS, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(card, { toValue: 1, duration: DIALOG_MS, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: NATIVE_DRIVER }),
    ]).start();
  }, [card, reducedMotion, scrim]);

  const openStore = async () => {
    // Re-validated at the moment of opening: only this app's official listing.
    const url = validStoreUrl(storeUrl, currentAppPlatform());
    if (!url) {
      setOpenFailed(true);
      return;
    }
    try {
      await Linking.openURL(url);
      setOpenFailed(false);
    } catch {
      setOpenFailed(true);
    }
  };

  const storeLabel = t(Platform.OS === "android" ? "update.action.googlePlay" : "update.action.appStore");
  const body = "version" in copy.body ? t(copy.body.key, { version: copy.body.version }) : t(copy.body.key);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // Android Back: swallowed for a required update; "Not now" for an optional one.
      onRequestClose={() => {
        if (dismissible) onDismiss?.();
      }}
    >
      <View
        style={[
          styles.root,
          {
            paddingTop: 28 + insets.top,
            paddingBottom: 28 + insets.bottom,
            paddingLeft: 28 + insets.left,
            paddingRight: 28 + insets.right,
          },
        ]}
      >
        {/* v3 scrim: rgba(0,0,0,.5); not a dismiss target. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]} accessible={false} importantForAccessibility="no" />
        <Animated.View
          accessibilityViewIsModal
          aria-modal
          role="alertdialog"
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              opacity: card,
              transform: [{ scale: card.interpolate({ inputRange: [0, 1], outputRange: [DIALOG_FROM_SCALE, 1] }) }],
            },
          ]}
        >
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <SystemLogoTile size={72} radius={20} crest={46} label={t("maintenance.logo")} />
            <AppText variant="displaySection" accessibilityRole="header" align="center" style={styles.title}>
              {t(copy.titleKey)}
            </AppText>
            <AppText variant="body" tone="muted" align="center" style={styles.body}>
              {body}
            </AppText>
            {copy.releaseNotes.length > 0 ? (
              <View style={[styles.notes, { backgroundColor: theme.colors.bgAlt }]}>
                <AppText
                  accessibilityRole="header"
                  style={[styles.notesTitle, fontStyleFor("text", "600", meta.script), { color: theme.colors.textMuted }, latin && styles.notesTitleLatin]}
                >
                  {t("update.whatsNew")}
                </AppText>
                {copy.releaseNotes.map((note, index) => (
                  <View key={`${index}-${note}`} style={styles.note}>
                    <View style={[styles.noteDot, { backgroundColor: theme.colors.actionPrimary }]} />
                    <AppText style={styles.noteText}>{note}</AppText>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.actions}>
              <Button title={storeLabel} onPress={() => void openStore()} />
              {dismissible ? (
                <Pressable
                  onPress={onDismiss}
                  accessibilityRole="button"
                  accessibilityLabel={t("update.notNow")}
                  style={({ pressed }) => [styles.notNow, pressed && { opacity: 0.6 }]}
                >
                  <AppText style={[styles.notNowText, fontStyleFor("text", "500", meta.script), { color: theme.colors.textMuted }]}>
                    {t("update.notNow")}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
            {openFailed ? (
              <AppText variant="meta" tone="danger" align="center" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.openFailed}>
                {`${t("update.openFailed.title")}. ${t("update.openFailed.message")}`}
              </AppText>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// LFA Screen v3 update dialog: padding 28; card radius --dlgR, padding 26 20 16,
// shadow 0 24 60 rgba(0,0,0,.35); tile 72; title margin-top 16, Barlow 700 28/1.05
// uppercase; body margin-top 8, 15/1.45 muted; notes margin-top 14, padding 14 16,
// radius 14, --bg2, gap 8; actions margin-top 16, gap 8; "Not now" 48 tall, 16/500.
const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrim: { backgroundColor: "rgba(0,0,0,0.5)" },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "100%",
    borderRadius: DIALOG_RADIUS,
    overflow: "hidden",
    boxShadow: "0px 24px 60px rgba(0,0,0,0.35)",
  },
  content: { paddingTop: 26, paddingHorizontal: 20, paddingBottom: 16, alignItems: "center" },
  title: { marginTop: 16, fontSize: 28, lineHeight: 30 },
  body: { marginTop: 8, lineHeight: 22 },
  notes: { marginTop: 14, alignSelf: "stretch", gap: 8, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14 },
  notesTitle: { fontSize: 13, lineHeight: 17 },
  // v3 uppercase, .06em; Latin only.
  notesTitleLatin: { textTransform: "uppercase", letterSpacing: 0.78 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  noteDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  noteText: { flex: 1, fontSize: 14, lineHeight: 19.6 },
  actions: { marginTop: 16, alignSelf: "stretch", gap: 8 },
  notNow: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  notNowText: { fontSize: 16, lineHeight: 21 },
  openFailed: { marginTop: 8 },
});
