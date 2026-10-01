import { AuthRequired } from "@/components/AuthRequired";
import { ChangePassword } from "@/components/ChangePassword";
import { ProfilePhotoSheet } from "@/components/ProfilePhotoSheet";
import { TabHeader } from "@/components/TabHeader";
import { AppText } from "@/components/foundation";
import { Loading, Screen, useResponsive, useTheme } from "@/components/ui";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useProfilePhoto } from "@/hooks/useProfilePhoto";
import { useI18n } from "@/i18n/I18nProvider";
import { storageUrl } from "@/lib/config";
import { spacing } from "@/lib/designTokens";
import { formatMonthYear } from "@/lib/format";
import { profileFacts } from "@/lib/profileFacts";
import { authService } from "@/services/auth";
import type { User } from "@/types";
import { Stack, router, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";

/**
 * Profile (LFA Screen v3). Account data comes from `/auth/me` (the source of
 * truth; the cached `auth.user` covers the moment before it loads). Name,
 * email and phone are read-only in the app; the avatar is the only editable
 * field (`useProfilePhoto`). "Member since" and "Verified" are shown only
 * from the backend's `created_at` and `email_verified_at`.
 */
function ProfileScreen() {
  const auth = useAuth();
  const { isAuthenticated, updateUser } = auth;
  const alertDialog = useAlertDialog();
  const toast = useToast();
  const theme = useTheme();
  const i18n = useI18n();
  const responsive = useResponsive();
  const [profile, setProfile] = useState<User | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const displayUser = profile ?? auth.user;
  const currentUser = useCallback(() => profile ?? auth.user, [auth.user, profile]);
  const photo = useProfilePhoto({ currentUser, onUserUpdated: setProfile });

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    authService
      .me()
      .then((nextUser) => {
        if (cancelled) return;
        setProfile(nextUser);
        void updateUser(nextUser);
      })
      .catch(() => {
        // The cached profile stays on screen; nothing here is editable anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, updateUser]);

  const logout = async () => {
    const confirmed = await alertDialog.showAlert({
      title: "Log out?",
      message: "Are you sure you want to log out?",
      variant: "destructive",
      cancelLabel: "Cancel",
      confirmLabel: "Log out",
      dismissible: true,
    });
    if (!confirmed) return;

    try {
      await auth.logout();
    } catch {
      toast.showToast({
        variant: "error",
        title: "Could not log out",
        message: "Your local session was cleared.",
      });
    } finally {
      router.replace("/");
    }
  };

  if (!auth.isReady) return <Loading />;
  if (!auth.isAuthenticated)
    return (
      <Screen>
        <View style={[local.shell, { width: responsive.contentWidth }]}>
          <TabHeader title={i18n.t("profile.title")} />
          <ScrollView contentContainerStyle={local.content} showsVerticalScrollIndicator={false}>
            <AuthRequired />
            <PublicMenu />
          </ScrollView>
        </View>
      </Screen>
    );

  const facts = profileFacts(displayUser);
  const avatar = displayUser?.avatar ? storageUrl(displayUser.avatar) : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: i18n.t("profile.title") }} />
      <View style={[local.shell, { width: responsive.contentWidth }]}>
        <TabHeader title={i18n.t("profile.title")} />
        <ScrollView contentContainerStyle={local.content} showsVerticalScrollIndicator={false}>
          <View style={local.identity}>
            <Pressable
              onPress={() => setPhotoSheet(true)}
              disabled={photo.busy}
              accessibilityRole="button"
              accessibilityLabel={avatar ? i18n.t("profile.photo.change") : i18n.t("profile.photo.add")}
              aria-busy={photo.busy}
              style={({ pressed }) => [local.avatarPress, pressed && { transform: [{ scale: 0.96 }] }]}
            >
              <View style={[local.avatar, { backgroundColor: theme.colors.hero }]}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={local.avatarImage} resizeMode="cover" accessible={false} />
                ) : (
                  <AppText variant="displaySection" tone="onHero">{facts.initials}</AppText>
                )}
              </View>
              <View style={[local.cameraBadge, { backgroundColor: theme.colors.actionPrimary, borderColor: theme.colors.background }]}>
                {photo.busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <SymbolView name={{ ios: "camera.fill", android: "photo_camera", web: "photo_camera" }} size={16} tintColor="#FFFFFF" fallback={<View />} />
                )}
              </View>
            </Pressable>
            <AppText variant="displayDay" align="center" style={local.name}>{facts.name}</AppText>
            {facts.memberSince ? (
              <AppText variant="meta" tone="muted" align="center" style={local.regular}>
                {i18n.t("profile.memberSince", { date: formatMonthYear(facts.memberSince) })}
              </AppText>
            ) : null}
          </View>

          <Card>
            {facts.email ? (
              <InfoRow icon={{ ios: "envelope", android: "mail", web: "mail" }} value={facts.email} first>
                {facts.emailVerified ? (
                  <View style={local.verified}>
                    <SymbolView name={{ ios: "checkmark.shield", android: "verified_user", web: "verified_user" } as never} size={14} tintColor={theme.colors.tones.success.fg} fallback={<View />} />
                    <AppText variant="caption" style={{ color: theme.colors.tones.success.fg, fontWeight: "600" }}>{i18n.t("profile.verified")}</AppText>
                  </View>
                ) : null}
              </InfoRow>
            ) : null}
            {facts.phone ? (
              <InfoRow icon={{ ios: "phone", android: "phone", web: "phone" }} value={facts.phone} first={!facts.email} />
            ) : null}
          </Card>
          <AppText variant="caption" tone="muted" style={local.note}>{i18n.t("profile.readOnly")}</AppText>

          <Card>
            <ChangePassword trigger="menu" />
            <MenuRow icon={{ ios: "gearshape", android: "settings", web: "settings" }} label={i18n.t("profile.menu.settings")} href="/settings" />
            <MenuRow icon={{ ios: "doc.text", android: "description", web: "description" }} label={i18n.t("profile.menu.legal")} href="/legal" />
            <MenuRow icon={{ ios: "message", android: "chat", web: "chat" }} label={i18n.t("profile.menu.contact")} href="/contact" />
          </Card>

          <Pressable
            onPress={() => void logout()}
            accessibilityRole="button"
            accessibilityLabel={i18n.t("profile.logout")}
            style={({ pressed }) => [local.logout, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }, pressed && { opacity: 0.85 }]}
          >
            <AppText variant="bodyStrong" style={{ color: theme.colors.brandInk, fontSize: 17 }}>{i18n.t("profile.logout")}</AppText>
          </Pressable>
        </ScrollView>
      </View>
      <ProfilePhotoSheet
        visible={photoSheet}
        hasPhoto={Boolean(avatar)}
        busy={photo.busy}
        onClose={() => setPhotoSheet(false)}
        onChoose={photo.chooseFromGallery}
        onTakePhoto={photo.takePhoto}
        onRemove={photo.removePhoto}
      />
    </Screen>
  );
}

/** Signed-out: the public destinations (legal, contact) stay reachable. */
function PublicMenu() {
  const i18n = useI18n();
  return (
    <Card>
      <MenuRow icon={{ ios: "doc.text", android: "description", web: "description" }} label={i18n.t("profile.menu.legal")} href="/legal" first />
      <MenuRow icon={{ ios: "message", android: "chat", web: "chat" }} label={i18n.t("profile.menu.contact")} href="/contact" />
    </Card>
  );
}

function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[local.card, { backgroundColor: theme.colors.surface, boxShadow: theme.colors.shadowCard }]}>{children}</View>;
}

function InfoRow({ icon, value, first = false, children }: { icon: { ios: string; android: string; web: string }; value: string; first?: boolean; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[local.infoRow, !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }]} accessible>
      <SymbolView name={icon as never} size={20} tintColor={theme.colors.textMuted} fallback={<View />} />
      <AppText variant="body" numberOfLines={1} style={local.infoValue}>{value}</AppText>
      {children}
    </View>
  );
}

function MenuRow({ icon, label, href, first = false }: { icon: { ios: string; android: string; web: string }; label: string; href: Href; first?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [local.menuRow, !first && { borderTopWidth: 1, borderTopColor: theme.colors.hairline }, pressed && { backgroundColor: theme.colors.surfaceSecondary }]}
    >
      <View style={[local.menuIcon, { backgroundColor: theme.colors.bgAlt }]}>
        <SymbolView name={icon as never} size={17} tintColor={theme.colors.textStrong} fallback={<View />} />
      </View>
      <AppText variant="body" style={local.menuLabel}>{label}</AppText>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={theme.colors.textMuted} fallback={<View />} />
    </Pressable>
  );
}

const local = {
  shell: { flex: 1, alignSelf: "center" as const },
  content: { gap: spacing.lg, paddingBottom: spacing.xxxl },
  identity: { alignItems: "center" as const, paddingTop: 14, paddingBottom: spacing.sm },
  avatarPress: { width: 96, height: 96 },
  // v3: 96pt night circle, initials 32; 32pt red camera badge ringed by the canvas.
  avatar: { width: 96, height: 96, borderRadius: 48, overflow: "hidden" as const, alignItems: "center" as const, justifyContent: "center" as const },
  avatarImage: { width: "100%" as const, height: "100%" as const },
  cameraBadge: {
    position: "absolute" as const,
    end: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  name: { marginTop: 14 },
  regular: { fontWeight: "400" as const, marginTop: 2 },
  card: { borderRadius: 20, overflow: "hidden" as const },
  infoRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 14, paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 50 },
  infoValue: { flex: 1, minWidth: 0 },
  verified: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
  note: { paddingHorizontal: spacing.lg, marginTop: -spacing.sm },
  menuRow: { minHeight: 54, flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  menuIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center" as const, justifyContent: "center" as const },
  menuLabel: { flex: 1 },
  logout: { minHeight: 50, borderRadius: 16, alignItems: "center" as const, justifyContent: "center" as const },
};

/**
 * The Profile tab renders its own signed-out state (sign in plus the public
 * legal/contact destinations). Keyed per account, so a previous user's
 * fresh profile can never show for the next one.
 */
export default function ProfileTab() {
  const auth = useAuth();
  return <ProfileScreen key={auth.userCacheKey ?? "guest"} />;
}
