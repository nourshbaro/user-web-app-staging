import { translate } from "@/i18n/runtime";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { runOwnedAvatarMutation } from "@/lib/avatarMutationOwnership";
import { userFacingError } from "@/lib/userFacingError";
import { captureAuthenticationSnapshot, isAuthenticationSnapshotCurrent } from "@/services/api";
import { authService } from "@/services/auth";
import type { User } from "@/types";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import { Linking } from "react-native";

/**
 * The profile photo operations (moved unchanged from Edit Profile): gallery
 * and camera permission handling, upload and removal through `authService`,
 * then publishing the new avatar through `AuthContext.updateUser`. The only
 * account field the app can change is the avatar. A result is published only
 * while the session that started it is still current
 * (`runOwnedAvatarMutation`); a result that outlives its session is dropped
 * silently, so it never reaches another account.
 */
export function useProfilePhoto({ currentUser, onUserUpdated }: { currentUser: () => User | null; onUserUpdated?: (user: User) => void }) {
  const auth = useAuth();
  const toast = useToast();
  const alertDialog = useAlertDialog();
  const [busy, setBusy] = useState(false);

  const publish = useCallback(
    async (nextUser: User) => {
      onUserUpdated?.(nextUser);
      await auth.updateUser(nextUser);
    },
    [auth, onUserUpdated],
  );

  const uploadSelectedPhoto = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (!asset.uri) {
        toast.showToast({ variant: "error", title: translate("photo.unusable"), message: translate("photo.chooseAnother") });
        return;
      }
      try {
        setBusy(true);
        const fileName = asset.fileName ?? `avatar.${asset.mimeType === "image/png" ? "png" : "jpg"}`;
        const mimeType = asset.mimeType ?? "image/jpeg";
        const outcome = await runOwnedAvatarMutation({
          capture: captureAuthenticationSnapshot,
          isCurrent: isAuthenticationSnapshotCurrent,
          request: () => authService.uploadProfilePicture({ uri: asset.uri, name: fileName, type: mimeType }),
          nextUser: (response) => {
            const user = currentUser();
            return response.avatar && user ? { ...user, avatar: response.avatar } : null;
          },
          publish,
        });
        if (outcome === "stale") return;
        toast.showToast({ variant: "success", title: translate("photo.updated"), message: translate("photo.updated.detail") });
      } catch (error) {
        console.error("[avatar] upload failed:", error);
        toast.showToast({ variant: "error", title: translate("photo.updateFailed"), message: userFacingError(error, translate("photo.retry")) });
      } finally {
        setBusy(false);
      }
    },
    [currentUser, publish, toast],
  );

  const explainDenied = useCallback(
    async (kind: "photos" | "camera", canAskAgain: boolean) => {
      const photos = kind === "photos";
      if (canAskAgain) {
        toast.showToast({
          variant: "error",
          title: photos ? translate("photo.access") : translate("photo.cameraAccess"),
          message: photos
            ? translate("photo.askPhotos")
            : translate("photo.askCamera"),
        });
        return;
      }
      const openSettings = await alertDialog.showAlert({
        title: photos ? translate("photo.access") : translate("photo.cameraAccess"),
        message: photos
          ? translate("photo.settingsPhotos")
          : translate("photo.settingsCamera"),
        variant: "confirm",
        cancelLabel: translate("deleteAccount.cancel"),
        confirmLabel: translate("photo.openSettings"),
        dismissible: true,
      });
      if (!openSettings) return;
      try {
        await Linking.openSettings();
      } catch (error) {
        console.error("[avatar] open settings failed:", error);
        toast.showToast({
          variant: "error",
          title: translate("settings.openFailed"),
          message: translate(photos ? "photo.settingsPhotos" : "photo.settingsCamera"),
        });
      }
    },
    [alertDialog, toast],
  );

  const chooseFromGallery = useCallback(async () => {
    if (busy) return;
    try {
      let permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        await explainDenied("photos", permission.canAskAgain);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      await uploadSelectedPhoto(asset);
    } catch (error) {
      console.error("[avatar] gallery failed:", error);
      toast.showToast({ variant: "error", title: translate("photo.galleryFailed"), message: translate("photo.retry") });
    }
  }, [busy, explainDenied, toast, uploadSelectedPhoto]);

  const takePhoto = useCallback(async () => {
    if (busy) return;
    try {
      let permission = await ImagePicker.getCameraPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        await explainDenied("camera", permission.canAskAgain);
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled) return;
      await uploadSelectedPhoto(result.assets[0]);
    } catch (error) {
      console.error("[avatar] camera failed:", error);
      toast.showToast({ variant: "error", title: translate("photo.cameraFailed"), message: translate("photo.retry") });
    }
  }, [busy, explainDenied, toast, uploadSelectedPhoto]);

  /** Confirms, then removes the avatar (the user returns to initials). */
  const removePhoto = useCallback(async () => {
    if (busy) return;
    const confirmed = await alertDialog.showAlert({
      title: translate("photo.remove.confirm"),
      message: translate("photo.remove.detail"),
      variant: "destructive",
      cancelLabel: translate("deleteAccount.cancel"),
      confirmLabel: translate("cart.remove.confirm.action"),
      dismissible: true,
    });
    if (!confirmed) return;
    try {
      setBusy(true);
      const outcome = await runOwnedAvatarMutation({
        capture: captureAuthenticationSnapshot,
        isCurrent: isAuthenticationSnapshotCurrent,
        request: () => authService.removeProfilePicture(),
        nextUser: () => {
          const user = currentUser();
          return user ? { ...user, avatar: null } : null;
        },
        publish,
      });
      if (outcome === "stale") return;
      toast.showToast({ variant: "success", title: translate("photo.removed"), message: translate("photo.removed.detail") });
    } catch (error) {
      console.error("[avatar] remove failed:", error);
      toast.showToast({ variant: "error", title: translate("photo.removeFailed"), message: userFacingError(error, translate("photo.retry")) });
    } finally {
      setBusy(false);
    }
  }, [alertDialog, busy, currentUser, publish, toast]);

  return { busy, chooseFromGallery, takePhoto, removePhoto };
}
