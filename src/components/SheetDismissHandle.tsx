import { useI18n } from "@/i18n/I18nProvider";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";

export function SheetDismissHandle({ onDismiss, color, disabled = false }: { onDismiss: () => void; color: string; disabled?: boolean }) {
  const { t } = useI18n();
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onEnd((event) => {
      if (event.translationY > 72 || event.velocityY > 650) scheduleOnRN(onDismiss);
    }), [disabled, onDismiss]);

  return (
    <GestureDetector gesture={gesture}>
      <View accessibilityRole="adjustable" accessibilityLabel={t("common.swipeClose")} style={styles.touchTarget}>
        <View style={[styles.handle, { backgroundColor: color }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  touchTarget: { height: 30, alignItems: "center", justifyContent: "center" },
  handle: { width: 42, height: 4, borderRadius: 2, opacity: 0.48 },
});
