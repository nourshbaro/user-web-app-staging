import { SubpageShell } from "@/components/SubpageShell";
import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, View } from "react-native";

/**
 * Legal (v3): the two published documents. Their content is the backend's
 * (`legalService`); nothing here writes legal copy.
 */
export default function LegalScreen() {
  const theme = useTheme();
  const i18n = useI18n();
  const rows = [
    { key: "privacy", label: i18n.t("legal.privacy.title"), href: "/legal/privacy" as const },
    { key: "terms", label: i18n.t("legal.terms.title"), href: "/legal/terms" as const },
  ];
  return (
    <SubpageShell title={i18n.t("legal.title")} backLabel={i18n.t("profile.title")} fallback="/profile">
      <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
        {rows.map((row, index) => (
          <Pressable
            key={row.key}
            onPress={() => router.push(row.href)}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            style={({ pressed }) => [local.row, index > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }, pressed && { backgroundColor: theme.colors.surfaceSecondary }]}
          >
            <View style={[local.icon, { backgroundColor: theme.colors.tones.brand.bg }]}>
              <SymbolView name={{ ios: "doc.text", android: "description", web: "description" } as never} size={20} tintColor={theme.colors.actionPrimary} fallback={<View />} />
            </View>
            <AppText variant="body" style={local.label}>{row.label}</AppText>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={18} tintColor={theme.colors.textMuted} fallback={<View />} />
          </Pressable>
        ))}
      </View>
    </SubpageShell>
  );
}

const local = {
  card: { borderRadius: 20, overflow: "hidden" as const },
  row: { minHeight: 64, flexDirection: "row" as const, alignItems: "center" as const, gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const },
  label: { flex: 1, fontWeight: "500" as const, fontSize: 16 },
};
