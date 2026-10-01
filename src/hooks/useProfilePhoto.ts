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
        toast.showToast({ variant: "error", title: "Could not use photo", message: "Please choose another image." });
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
        toast.showToast({ variant: "success", title: "Profile picture updated", message: "Your profile picture was updated." });
      } catch (error) {
        console.error("[avatar] upload failed:", error);
        toast.showToast({ variant: "error", title: "Could not update photo", message: userFacingError(error, "Please try again.") });
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
          title: photos ? "Photo access required" : "Camera access required",
          message: photos
            ? "Allow photo access to choose a profile picture. Tap Choose new photo to try again."
            : "Allow camera access to take a profile picture. Tap Take photo to try again.",
        });
        return;
      }
      const openSettings = await alertDialog.showAlert({
        title: photos ? "Photo access required" : "Camera access required",
        message: photos
          ? "Allow Photos access for LFA Tickets in Settings to choose a profile picture."
          : "Allow Camera access for LFA Tickets in Settings to take a profile picture.",
        variant: "confirm",
        cancelLabel: "Cancel",
        confirmLabel: "Open Settings",
        dismissible: true,
      });
      if (!openSettings) return;
      try {
        await Linking.openSettings();
      } catch (error) {
        console.error("[avatar] open settings failed:", error);
        toast.showToast({
          variant: "error",
          title: "Could not open settings",
          message: `Open your device settings, select LFA Tickets, and allow ${photos ? "Photos" : "Camera"} access.`,
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
      toast.showToast({ variant: "error", title: "Could not open gallery", message: "Please try again." });
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
      toast.showToast({ variant: "error", title: "Could not take photo", message: "Please try again." });
    }
  }, [busy, explainDenied, toast, uploadSelectedPhoto]);

  /** Confirms, then removes the avatar (the user returns to initials). */
  const removePhoto = useCallback(async () => {
    if (busy) return;
    const confirmed = await alertDialog.showAlert({
      title: "Remove profile photo?",
      message: "Your profile will return to your initials.",
      variant: "destructive",
      cancelLabel: "Cancel",
      confirmLabel: "Remove",
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
      toast.showToast({ variant: "success", title: "Profile picture removed", message: "Your profile picture was removed." });
    } catch (error) {
      console.error("[avatar] remove failed:", error);
      toast.showToast({ variant: "error", title: "Could not remove photo", message: userFacingError(error, "Please try again.") });
    } finally {
      setBusy(false);
    }
  }, [alertDialog, busy, currentUser, publish, toast]);

  return { busy, chooseFromGallery, takePhoto, removePhoto };
}
