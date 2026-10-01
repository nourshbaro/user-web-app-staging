import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { useRef } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Action = () => Promise<void>;

/**
 * v3 profile-photo action sheet (Choose new photo / Take photo / Remove photo
 * / Cancel). Presentation only: the actions are `useProfilePhoto`'s. On iOS a
 * picker cannot open while this modal is still dismissing, so the chosen
 * action runs from `onDismiss` (the existing Edit Profile behaviour).
 */
export function ProfilePhotoSheet({
  visible,
  hasPhoto,
  busy,
  onClose,
  onChoose,
  onTakePhoto,
  onRemove,
}: {
  visible: boolean;
  hasPhoto: boolean;
  busy: boolean;
  onClose: () => void;
  onChoose: Action;
  onTakePhoto: Action;
  onRemove: Action;
}) {
  const theme = useTheme();
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  const pending = useRef<Action | null>(null);

  const run = (action: Action) => {
    if (busy || pending.current) return;
    if (Platform.OS === "ios") {
      pending.current = action;
      onClose();
    } else {
      onClose();
      void action();
    }
  };

  const option = (label: string, action: Action, tone: "brand" | "strong" = "strong") => (
    <Pressable
      key={label}
      onPress={() => run(action)}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={busy}
      style={({ pressed }) => [local.option, { borderTopColor: theme.colors.hairline }, pressed && { backgroundColor: theme.colors.surfaceSecondary }]}
    >
      <AppText variant="body" align="center" style={[local.optionText, { color: tone === "brand" ? theme.colors.brandInk : theme.colors.textStrong }]}>
        {label}
      </AppText>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      onDismiss={() => {
        const action = pending.current;
        pending.current = null;
        if (action) void action();
      }}
    >
      <Pressable style={local.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={i18n.t("common.close")} />
      <View style={[local.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
        <View style={[local.group, { backgroundColor: theme.colors.surface }]}>
          <AppText variant="meta" tone="muted" align="center" style={local.title}>{i18n.t("profile.photo.title")}</AppText>
          {option(i18n.t("profile.photo.choose"), onChoose, "brand")}
          {option(i18n.t("profile.photo.take"), onTakePhoto, "brand")}
          {hasPhoto ? option(i18n.t("profile.photo.remove"), onRemove) : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={i18n.t("profile.photo.cancel")}
          style={({ pressed }) => [local.group, local.cancel, { backgroundColor: theme.colors.surface }, pressed && { opacity: 0.8 }]}
        >
          <AppText variant="bodyStrong" align="center" style={local.optionText}>{i18n.t("profile.photo.cancel")}</AppText>
        </Pressable>
      </View>
    </Modal>
  );
}

const local = {
  backdrop: { position: "absolute" as const, top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  // v3: bottom action sheet, padding 0 10 34, gap 8, radius 16 groups.
  sheet: { position: "absolute" as const, left: 10, right: 10, bottom: 0, gap: 8 },
  group: { borderRadius: 16, overflow: "hidden" as const },
  title: { paddingVertical: 14, fontWeight: "400" as const },
  option: { minHeight: 56, justifyContent: "center" as const, borderTopWidth: 1 },
  optionText: { fontSize: 19 },
  cancel: { minHeight: 56, justifyContent: "center" as const },
};
