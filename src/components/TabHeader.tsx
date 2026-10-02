import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/i18n/I18nProvider";
import { storageUrl } from "@/lib/config";
import { size, spacing } from "@/lib/designTokens";
import { homeAvatar } from "@/lib/homeAvatar";
import { teamInitials } from "@/lib/matchDiscovery";
import { setPrimaryTabTransitionDirection } from "@/lib/navigationPresentation";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState, type ReactNode } from "react";
import { Image, Pressable, View } from "react-native";

/**
 * Primary-tab header (v3): the 40pt condensed uppercase title and an optional
 * trailing control. The status-bar inset is already applied by `Screen`; the
 * header draws no background of its own.
 */
export function TabHeader({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: ReactNode }) {
  return (
    <View style={local.titleRow}>
      <View style={local.copy}>
        <AppText variant="displayTitle" accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {title}
        </AppText>
        {subtitle ? <AppText variant="meta" tone="muted" numberOfLines={2}>{subtitle}</AppText> : null}
      </View>
      {trailing ?? null}
    </View>
  );
}

/**
 * Home's brand header (v3): LFA mark, app name and federation, and the
 * account avatar that opens Profile. The avatar is the signed-in user's
 * profile image from `AuthContext` (resolved like Profile's), falling back to
 * the v3 initials, or the person mark when signed out (`homeAvatar`).
 */
export function BrandHeader() {
  const theme = useTheme();
  const { t } = useI18n();
  const auth = useAuth();
  // An image that failed to load falls back until the user's avatar changes.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const avatar = homeAvatar({
    isAuthenticated: auth.isAuthenticated,
    user: auth.user,
    failedUri,
    resolveImage: storageUrl,
    initialsOf: (name) => teamInitials({ name }),
  });

  return (
    <View style={local.brandRow}>
      <Image
        source={require("../../assets/images/lfa-logo.png")}
        style={local.logo}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        accessible={false}
      />
      <View style={local.copy}>
        <AppText variant="cardTitle" accessibilityRole="header" numberOfLines={1} style={local.appName}>{t("brand.appName")}</AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1}>{t("brand.federation")}</AppText>
      </View>
      <Pressable
        onPress={() => {
          // Same semantics as the Profile tab: replace, forward transition.
          setPrimaryTabTransitionDirection(1);
          router.replace("/profile");
        }}
        accessibilityRole="button"
        accessibilityLabel={t("home.profile.a11y")}
        hitSlop={3}
        style={({ pressed }) => [local.avatar, { backgroundColor: theme.colors.hero, opacity: pressed ? 0.85 : 1 }]}
      >
        {avatar.kind === "image" ? (
          <Image
            source={{ uri: avatar.uri }}
            style={local.avatarImage}
            resizeMode="cover"
            accessible={false}
            onError={() => setFailedUri(avatar.uri)}
          />
        ) : avatar.kind === "initials" ? (
          <AppText variant="label" tone="onHero" style={local.initials}>{avatar.initials}</AppText>
        ) : (
          <SymbolView
            accessible={false}
            name={{ ios: "person", android: "person_outline", web: "person_outline" } as never}
            size={18}
            tintColor={theme.colors.onHero}
            fallback={<View />}
          />
        )}
      </Pressable>
    </View>
  );
}

const local = {
  // v3 Matches header: padding 4 16 8 20.
  titleRow: {
    minHeight: size.touchTarget,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    paddingTop: spacing.xs,
    paddingStart: spacing.xs,
  },
  // v3 Home header: padding 6 20 16, gap 10.
  brandRow: {
    minHeight: size.touchTarget,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingTop: 6,
    paddingStart: spacing.xs,
  },
  copy: { flex: 1, minWidth: 0 },
  logo: { width: 36, height: 36 },
  appName: { fontSize: 18, lineHeight: 22 },
  // v3: 38pt night circle; kept at the 44pt minimum touch target via hitSlop.
  avatar: { width: 38, height: 38, borderRadius: 19, overflow: "hidden" as const, alignItems: "center" as const, justifyContent: "center" as const },
  avatarImage: { width: "100%" as const, height: "100%" as const },
  initials: { fontSize: 13, lineHeight: 17 },
};
