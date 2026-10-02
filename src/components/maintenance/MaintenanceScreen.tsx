import { AppText } from "@/components/foundation";
import { SystemLogoTile } from "@/components/maintenance/SystemLogoTile";
import { Button, useTheme } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { OFFICIAL_CONTACTS } from "@/lib/contact";
import { fontStyleFor } from "@/lib/fontFamilies";
import type { MaintenanceRecheckResult } from "@/lib/maintenanceAuthority";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The official WhatsApp contact (`src/lib/contact.ts`), the same one Contact LFA offers. */
type Contact = (typeof OFFICIAL_CONTACTS)[number];
const WHATSAPP = OFFICIAL_CONTACTS.find((contact): contact is Extract<Contact, { brand: "whatsapp" }> => "brand" in contact && contact.brand === "whatsapp");

/** v3 `lfFade .25s`. */
const FADE_MS = 250;

/**
 * LFA Screen v3 `maintenance`: a full-screen takeover shown while the backend
 * answers 503. "Try again" asks the maintenance authority to re-check the
 * backend (`onRetry`); it never clears maintenance by itself. Nothing here
 * touches the session, the cart or a payment.
 */
export function MaintenanceScreen({ onRetry }: { onRetry: () => Promise<MaintenanceRecheckResult> }) {
  const theme = useTheme();
  const { t, meta } = useI18n();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  const [opacity] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const latin = meta.script === "latin";

  useEffect(() => {
    mounted.current = true;
    if (reducedMotion) {
      opacity.setValue(1);
    } else {
      Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: Platform.OS !== "web" }).start();
    }
    return () => {
      mounted.current = false;
    };
  }, [opacity, reducedMotion]);

  const retry = async () => {
    if (checking) return;
    setChecking(true);
    AccessibilityInfo.announceForAccessibility?.(t("maintenance.checking"));
    const result = await onRetry().catch((): MaintenanceRecheckResult => "unreachable");
    // On recovery this screen unmounts; only a failed check reports back.
    if (!mounted.current) return;
    setChecking(false);
    if (result === "recovered") return;
    toast.showToast(result === "maintenance"
      ? { variant: "info", title: t("maintenance.badge"), message: t("maintenance.stillDown") }
      : { variant: "error", title: t("maintenance.checkFailed"), message: t("maintenance.unreachable") });
  };

  const contact = async () => {
    if (!WHATSAPP) return;
    if (Platform.OS !== "web") {
      try {
        await Linking.openURL(WHATSAPP.appUrl);
        return;
      } catch {
        // WhatsApp is unavailable; continue with the universal web URL.
      }
    }
    try {
      await Linking.openURL(WHATSAPP.url);
    } catch {
      toast.showToast({ variant: "error", title: t("maintenance.contactFailed.title"), message: t("maintenance.contactFailed.message") });
    }
  };

  return (
    <Animated.View style={[styles.screen, { backgroundColor: theme.colors.background, opacity }]}>
      <ScrollView
        bounces={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(60, insets.top + 16),
            paddingBottom: Math.max(40, insets.bottom + 16),
            paddingLeft: 28 + insets.left,
            paddingRight: 28 + insets.right,
          },
        ]}
      >
        <View style={styles.column} accessibilityLiveRegion="polite">
          <SystemLogoTile size={84} radius={24} crest={54} label={t("maintenance.logo")} />
          <View style={[styles.pill, { backgroundColor: theme.colors.tones.brand.bg }]}>
            <View style={[styles.pillDot, { backgroundColor: theme.colors.actionPrimary }]} />
            <AppText style={[styles.pillText, fontStyleFor("text", "600", meta.script), { color: theme.colors.tones.brand.fg }, latin && styles.pillLatin]}>
              {t("maintenance.badge")}
            </AppText>
          </View>
          <AppText variant="displayHero" accessibilityRole="header" align="center" style={styles.title}>
            {t("maintenance.title")}
          </AppText>
          <AppText variant="body" tone="muted" align="center" style={styles.body}>
            {t("maintenance.body")}
          </AppText>
          <View style={styles.spacer} />
          <View style={styles.action}>
            <Button title={t("maintenance.retry")} onPress={() => void retry()} loading={checking} />
          </View>
          {WHATSAPP ? (
            <Pressable
              onPress={() => void contact()}
              accessibilityRole="link"
              accessibilityLabel={t("maintenance.contact")}
              accessibilityHint={WHATSAPP.detail}
              style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
            >
              <AppText style={[styles.linkText, fontStyleFor("text", "500", meta.script), { color: theme.colors.tones.brand.fg }]}>{t("maintenance.contact")}</AppText>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

// LFA Screen v3 `maintenance`: padding 60 28 40; tile 84; pill margin-top 22,
// padding 6 12, 13/600 uppercase; h1 margin-top 16, Barlow 700 38 uppercase;
// body margin-top 10, 15/1.5 muted, max-width 300; spacer ≤ 40; button
// margin-top 22, 52 tall; WhatsApp link margin-top 8, 44 tall, 15/500.
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  // Phone: the full width (v3 334 at 390). Tablet: a readable column.
  column: { width: "100%", maxWidth: 420, alignItems: "center" },
  pill: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 13, lineHeight: 17 },
  // v3 uppercase, .04em; Latin only (Arabic has no case, tracking breaks joining).
  pillLatin: { textTransform: "uppercase", letterSpacing: 0.52 },
  title: { marginTop: 16, fontSize: 38, lineHeight: 40 },
  body: { marginTop: 10, maxWidth: 300, lineHeight: 22.5 },
  spacer: { flexGrow: 1, maxHeight: 40, minHeight: 0 },
  action: { marginTop: 22, alignSelf: "stretch" },
  link: { marginTop: 8, minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  linkText: { fontSize: 15, lineHeight: 20 },
});
