import { ContactBrandIcon } from "@/components/ContactBrandIcon";
import { SubpageShell } from "@/components/SubpageShell";
import { AppText, DirectionalChevron } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { useI18n } from "@/i18n/I18nProvider";
import { OFFICIAL_CONTACTS } from "@/lib/contact";
import { spacing } from "@/lib/designTokens";
import { SymbolView } from "expo-symbols";
import { Linking, Platform, Pressable, View } from "react-native";

type Contact = (typeof OFFICIAL_CONTACTS)[number];

/**
 * Contact LFA (v3). The destinations are the allowlisted `OFFICIAL_CONTACTS`
 * only. WhatsApp tries the app first on a device, then the web link.
 */
export default function ContactScreen() {
  const theme = useTheme();
  const i18n = useI18n();
  const toast = useToast();

  const openContact = async (contact: Contact) => {
    if ("appUrl" in contact && Platform.OS !== "web") {
      try {
        await Linking.openURL(contact.appUrl);
        return;
      } catch {
        // WhatsApp is unavailable; continue with the universal web URL.
      }
    }

    try {
      await Linking.openURL(contact.url);
    } catch {
      toast.showToast({
        variant: "error",
        title: i18n.t("maintenance.contactFailed.title"),
        message: i18n.t("maintenance.contactFailed.message"),
      });
    }
  };

  return (
    <SubpageShell title={i18n.t("contact.title")} backLabel={i18n.t("profile.title")} fallback="/profile">
      {/* <AppText variant="body" tone="muted" style={local.intro}>{i18n.t("contact.intro")}</AppText> */}
      <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>
        {OFFICIAL_CONTACTS.map((contact, index) => {
          const brand = "brand" in contact ? contact.brand : null;
          return (
            <Pressable
              key={contact.label === "Email" ? i18n.t("auth.field.email") : contact.label}
              onPress={() => void openContact(contact)}
              accessibilityRole="link"
              accessibilityLabel={"accessibilityLabel" in contact ? i18n.t("contact.whatsapp") : i18n.t("auth.field.email")}
              accessibilityHint={contact.detail}
              style={({ pressed }) => [local.row, index > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }, pressed && { backgroundColor: theme.colors.surfaceSecondary }]}
            >
              <View
                style={[local.icon, { backgroundColor: theme.colors.tones.brand.bg }]}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
              >
                {brand ? (
                  <ContactBrandIcon brand={brand} color={theme.colors.actionPrimary} size={20} />
                ) : "icon" in contact ? (
                  <SymbolView name={contact.icon as never} size={20} tintColor={theme.colors.actionPrimary} fallback={<View />} />
                ) : null}
              </View>
              <View style={local.copy}>
                <AppText variant="body" style={local.label}>{contact.label === "Email" ? i18n.t("auth.field.email") : contact.label}</AppText>
                <AppText variant="meta" tone="muted" style={[local.detail, { writingDirection: "ltr" }]}>{contact.detail}</AppText>
              </View>
              <DirectionalChevron kind="forward" size={18} color={theme.colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
    </SubpageShell>
  );
}

const local = {
  intro: { paddingHorizontal: spacing.xs },
  card: { borderRadius: 20, overflow: "hidden" as const },
  // v3 row: 36pt tile, 14pt gap, padding 14 16.
  row: { minHeight: 64, flexDirection: "row" as const, alignItems: "center" as const, gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center" as const, justifyContent: "center" as const },
  copy: { flex: 1, minWidth: 0 },
  label: { fontWeight: "500" as const, fontSize: 16 },
  detail: { fontWeight: "400" as const, marginTop: 2 },
};
