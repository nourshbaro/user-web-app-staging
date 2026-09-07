import { AppHeader } from "@/components/AppHeader";
import {
  Input,
  Loading,
  Screen,
  useResponsive,
  useTheme,
} from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { storageUrl } from "@/lib/config";
import { authService, profileService } from "@/services/auth";
import * as ImagePicker from "expo-image-picker";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

const { width: windowWidth } = useWindowDimensions();

const modalWidth = Math.min(Math.max(windowWidth - 32, 280), 520);
const isTablet = windowWidth >= 768;

export default function EditProfileScreen() {
  const auth = useAuth();
  const toast = useToast();
  const theme = useTheme();
  const responsive = useResponsive();

  const [phone, setPhone] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);

  const [removePhotoVisible, setRemovePhotoVisible] = useState(false);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    void profileService
      .billingInfo()
      .then((value: any) =>
        setPhone(typeof value?.phone === "string" ? value.phone : ""),
      )
      .catch(() => undefined);
  }, [auth.isAuthenticated]);

  if (!auth.isReady) return <Loading />;

  const name = auth.user?.name?.trim() || "LFA supporter";
  const avatar = auth.user?.avatar ? storageUrl(auth.user.avatar) : null;

  const choosePhotoFromGallery = async () => {
    if (avatarBusy) {
      return;
    }

    setPhotoModalVisible(false);

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      if (!asset) {
        return;
      }

      await uploadSelectedPhoto(asset);
    } catch (error) {
      console.error("[avatar] gallery failed:", error);

      toast.showToast({
        variant: "error",
        title: "Could not open gallery",
        message: "Please try again.",
      });
    }
  };

  const uploadSelectedPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!asset.uri) {
      toast.showToast({
        variant: "error",
        title: "Could not use photo",
        message: "Please choose another image.",
      });
      return;
    }

    try {
      setAvatarBusy(true);

      const fileName =
        asset.fileName ??
        `avatar.${asset.mimeType === "image/png" ? "png" : "jpg"}`;

      const mimeType = asset.mimeType ?? "image/jpeg";

      const response = await authService.uploadProfilePicture({
        uri: asset.uri,
        name: fileName,
        type: mimeType,
      });

      if (response.avatar && auth.user) {
        await auth.updateUser({
          ...auth.user,
          avatar: response.avatar,
        });
      }

      toast.showToast({
        variant: "success",
        title: "Profile picture updated",
        message: "Your profile picture was updated.",
      });
    } catch (error) {
      console.error("[avatar] upload failed:", error);

      toast.showToast({
        variant: "error",
        title: "Could not update photo",
        message: "Please try again.",
      });
    } finally {
      setAvatarBusy(false);
    }
  };

  const takePhoto = async () => {
    if (avatarBusy) {
      return;
    }

    setPhotoModalVisible(false);

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        toast.showToast({
          variant: "error",
          title: "Camera access required",
          message: "Please allow camera access to take a profile picture.",
        });
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) {
        return;
      }

      await uploadSelectedPhoto(result.assets[0]);
    } catch (error) {
      console.error("[avatar] camera failed:", error);

      toast.showToast({
        variant: "error",
        title: "Could not take photo",
        message: "Please try again.",
      });
    }
  };

  const removePhoto = () => {
    if (avatarBusy) {
      return;
    }

    setPhotoModalVisible(false);

    <PhotoOption
      title="Remove"
      subtitle="Use the default profile avatar"
      icon={{
        ios: "minus.circle",
        android: "remove_circle_outline",
        web: "remove_circle_outline",
      }}
      destructive
      onPress={() => {
        setPhotoModalVisible(false);
        setRemovePhotoVisible(true);
      }}
    />;
  };

  const performRemovePhoto = async () => {
    try {
      setAvatarBusy(true);

      await authService.removeProfilePicture();

      if (auth.user) {
        await auth.updateUser({
          ...auth.user,
          avatar: null,
        });
      }

      toast.showToast({
        variant: "success",
        title: "Profile picture removed",
        message: "Your profile picture was removed.",
      });
    } catch (error) {
      console.error("[avatar] remove failed:", error);

      toast.showToast({
        variant: "error",
        title: "Could not remove photo",
        message: "Please try again.",
      });
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: "Edit Profile" }} />
      <View style={[styles.shell, { width: responsive.contentWidth }]}>
        <AppHeader title="Edit Profile" />
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ImageBackground
            source={avatar ? { uri: avatar } : undefined}
            resizeMode="cover"
            style={[
              styles.identity,
              {
                backgroundColor: theme.colors.panel,
                borderColor: theme.colors.line,
              },
            ]}
            imageStyle={styles.identityBackgroundImage}
          >
            {avatar ? (
              <View style={styles.identityImageOverlay} />
            ) : (
              <View
                style={[
                  styles.emptyAvatar,
                  {
                    backgroundColor: theme.colors.panelSoft,
                  },
                ]}
              >
                <Text
                  style={[styles.avatarText, { color: theme.colors.primary }]}
                >
                  {initials(auth.user?.name)}
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                avatar ? "Change profile picture" : "Add profile picture"
              }
              disabled={avatarBusy}
              onPress={() => setPhotoModalVisible(true)}
              style={({ pressed }) => [
                styles.cameraButton,
                {
                  backgroundColor: theme.colors.primary,
                },
                (pressed || avatarBusy) && styles.pressed,
              ]}
            >
              {avatarBusy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <SymbolView
                  name={{
                    ios: "camera.fill",
                    android: "photo_camera",
                    web: "photo_camera",
                  }}
                  size={22}
                  tintColor="#FFFFFF"
                  fallback={<Text style={styles.cameraFallback}>+</Text>}
                />
              )}
            </Pressable>

            <View style={styles.identityCopy}>
              <Text
                style={[
                  styles.name,
                  {
                    color: avatar ? "#FFFFFF" : theme.colors.ink,
                  },
                ]}
              >
                {name}
              </Text>

              {auth.user?.email ? (
                <Text
                  numberOfLines={1}
                  style={[
                    avatar
                      ? styles.identityImageSecondaryText
                      : theme.styles.muted,
                  ]}
                >
                  {auth.user.email}
                </Text>
              ) : null}
            </View>
          </ImageBackground>
          <Text style={[styles.sectionTitle, { color: theme.colors.muted }]}>
            Personal Info
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
            <InfoRow
              label="Name"
              value={auth.user?.name ?? ""}
              icon={{ ios: "person", android: "person", web: "person" }}
            />
            <InfoRow
              label="Email"
              value={auth.user?.email ?? ""}
              icon={{ ios: "envelope", android: "mail", web: "mail" }}
            />
            <InfoRow
              label="Phone"
              value={phone}
              icon={{ ios: "phone", android: "phone", web: "phone" }}
            />
          </View>
          <Text style={[styles.sectionTitle, { color: theme.colors.muted }]}>
            Password
          </Text>
          <View
            style={[
              styles.passwordGroup,
              {
                backgroundColor: theme.colors.panel,
                borderColor: theme.colors.line,
              },
            ]}
          >
            <Input
              label="Old Password"
              value=""
              editable={false}
              secureTextEntry
            />
            <Input
              label="New Password"
              value=""
              editable={false}
              secureTextEntry
            />
            <Input
              label="Confirm New Password"
              value=""
              editable={false}
              secureTextEntry
            />
          </View>
        </ScrollView>
      </View>
      <Modal
        visible={photoModalVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setPhotoModalVisible(false)}
      >
        <Pressable
          style={[
            styles.modalBackdrop,
            isTablet && styles.photoModalBackdropTablet,
          ]}
          onPress={() => setPhotoModalVisible(false)}
        >
          <Pressable
            style={[
              styles.photoSheet,
              isTablet && {
                width: Math.min(windowWidth - 48, 560),
                borderRadius: 28,
                marginBottom: 24,
              },
              {
                backgroundColor: theme.colors.panel,
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <View
              style={[
                styles.sheetHandle,
                {
                  backgroundColor: theme.colors.line,
                },
              ]}
            />

            <Text
              style={[
                styles.sheetTitle,
                {
                  color: theme.colors.ink,
                },
              ]}
            >
              Set Profile Picture
            </Text>

            <PhotoOption
              title="Gallery"
              subtitle="Choose a photo from your gallery"
              icon={{
                ios: "photo.on.rectangle",
                android: "photo_library",
                web: "photo_library",
              }}
              onPress={() => {
                void choosePhotoFromGallery();
              }}
            />

            <PhotoOption
              title="Camera"
              subtitle="Take a new photo"
              icon={{
                ios: "camera",
                android: "photo_camera",
                web: "photo_camera",
              }}
              onPress={() => {
                void takePhoto();
              }}
            />

            {avatar ? (
              <PhotoOption
                title="Remove"
                subtitle="Use the default profile avatar"
                icon={{
                  ios: "minus.circle",
                  android: "remove_circle_outline",
                  web: "remove_circle_outline",
                }}
                destructive
                onPress={removePhoto}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={removePhotoVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setRemovePhotoVisible(false)}
      >
        <Pressable
          style={styles.confirmBackdrop}
          onPress={() => setRemovePhotoVisible(false)}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.confirmDialog,
              {
                width: modalWidth,
                backgroundColor: theme.colors.panel,
                borderColor: theme.colors.line,
              },
            ]}
          >
            <View
              style={[
                styles.confirmIcon,
                {
                  backgroundColor: theme.colors.panelSoft,
                },
              ]}
            >
              <SymbolView
                name={{
                  ios: "trash",
                  android: "delete_outline",
                  web: "delete_outline",
                }}
                size={27}
                tintColor={theme.colors.danger}
                fallback={
                  <Text
                    style={{
                      color: theme.colors.danger,
                    }}
                  >
                    ×
                  </Text>
                }
              />
            </View>

            <View style={styles.confirmCopy}>
              <Text style={[styles.confirmTitle, { color: theme.colors.ink }]}>
                Remove Profile Photo?
              </Text>

              <Text
                style={[styles.confirmMessage, { color: theme.colors.muted }]}
              >
                Your profile will return to the default avatar.
              </Text>
            </View>

            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                disabled={avatarBusy}
                onPress={() => setRemovePhotoVisible(false)}
                style={({ pressed }) => [
                  styles.confirmButton,
                  {
                    borderColor: theme.colors.line,
                  },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.cancelText, { color: theme.colors.ink }]}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={avatarBusy}
                onPress={() => {
                  void (async () => {
                    await performRemovePhoto();
                    setRemovePhotoVisible(false);
                  })();
                }}
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.removeButton,
                  {
                    backgroundColor: theme.colors.danger,
                  },
                  (pressed || avatarBusy) && styles.pressed,
                ]}
              >
                {avatarBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.removeButtonText}>Remove</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function PhotoOption({
  title,
  subtitle,
  icon,
  destructive = false,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: any;
  destructive?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  const accent = destructive ? theme.colors.danger : theme.colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.photoOption,
        {
          borderColor: theme.colors.line,
        },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.photoOptionIcon,
          {
            backgroundColor: theme.colors.panelSoft,
          },
        ]}
      >
        <SymbolView
          name={icon}
          size={23}
          tintColor={accent}
          fallback={<Text style={{ color: accent }}>•</Text>}
        />
      </View>

      <View style={styles.photoOptionCopy}>
        <Text
          style={[
            styles.photoOptionTitle,
            {
              color: destructive ? theme.colors.danger : theme.colors.ink,
            },
          ]}
        >
          {title}
        </Text>

        <Text style={theme.styles.muted}>{subtitle}</Text>
      </View>

      <SymbolView
        name={{
          ios: "chevron.right",
          android: "chevron_right",
          web: "chevron_right",
        }}
        size={20}
        tintColor={theme.colors.muted}
        fallback={<Text>›</Text>}
      />
    </Pressable>
  );
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: any;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.infoRow, { borderBottomColor: theme.colors.line }]}>
      <View
        style={[styles.infoIcon, { backgroundColor: theme.colors.panelSoft }]}
      >
        <SymbolView
          name={icon}
          size={19}
          tintColor={theme.colors.primary}
          fallback={<Text>{label[0]}</Text>}
        />
      </View>
      <View style={styles.infoCopy}>
        <Text style={[styles.infoLabel, { color: theme.colors.ink }]}>
          {label}
        </Text>
        <Text numberOfLines={1} style={theme.styles.muted}>
          {value || "—"}
        </Text>
      </View>
    </View>
  );
}
function initials(value?: string) {
  if (!value?.trim()) return "LF";
  const parts = value.trim().split(/\s+/);
  return parts.length > 1
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}
const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignSelf: "center",
  },
  content: {
    gap: 12,
    paddingTop: 8,
    paddingBottom: 30,
  },
  identity: {
    minHeight: 260,
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    padding: 22,
    justifyContent: "flex-end",
  },
  identityBackgroundImage: {
    borderRadius: 22,
  },
  identityImageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  emptyAvatar: {
    position: "absolute",
    top: 54,
    alignSelf: "center",
    width: 96,
    height: 96,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  identityCopy: {
    gap: 4,
    zIndex: 2,
  },
  identityImageSecondaryText: {
    color: "rgba(255,255,255,0.84)",
  },
  cameraButton: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  avatarText: {
    fontSize: 27,
    fontWeight: "900",
  },
  cameraFallback: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  photoModalBackdropTablet: {
    alignItems: "center",
  },
  photoSheet: {
    width: "100%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
    gap: 14,
  },
  sheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 4,
  },
  photoOption: {
    minHeight: 82,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  photoOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  photoOptionCopy: {
    flex: 1,
    gap: 3,
  },
  photoOptionTitle: {
    fontSize: 17,
    fontWeight: "800",
  },
  name: {
    fontSize: 22,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.7,
  },
  sectionTitle: {
    marginTop: 8,
    marginLeft: 4,
    fontSize: 13,
    fontWeight: "800",
  },
  group: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  infoRow: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  infoIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  infoCopy: {
    flex: 1,
    gap: 2,
  },
  infoLabel: {
    fontSize: 15,
    fontWeight: "800",
  },
  passwordGroup: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  confirmDialog: {
    maxWidth: 520,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
    gap: 18,
  },
  confirmIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCopy: {
    width: "100%",
    alignItems: "center",
    gap: 7,
  },
  confirmTitle: {
    fontSize: 21,
    fontWeight: "900",
    textAlign: "center",
  },
  confirmMessage: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  confirmActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },
  confirmButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  removeButton: {
    borderWidth: 0,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "800",
  },
  removeButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});
