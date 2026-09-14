import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/components/ui";

const DRAG_DISMISS_THRESHOLD = 120;
const DRAG_DISMISS_VELOCITY = 0.6;

/**
 * Shared dismissible bottom sheet used across the ticket-purchase experience
 * (cart preview, payment method picker, account deletion, etc.) so every
 * modal in the app gets the same dismiss affordances for free:
 *   1. swipe down to dismiss
 *   2. tap the backdrop to dismiss
 *   3. an X icon in the top-right (never a textual "Close" button)
 *
 * Pass `dismissible={false}` for the rare case where dismissing mid-action
 * would leave the app in an unsafe/corrupt state (e.g. a delete-account
 * request in flight) — this hides the X and disables the swipe/backdrop
 * gestures without losing the rest of the sheet's behavior.
 */
export function BottomSheetModal({
  visible,
  onClose,
  title,
  subtitle,
  children,
  dismissible = true,
  closeLabel = "Close",
  wide,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  dismissible?: boolean;
  closeLabel?: string;
  wide?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Only the Animated.Value needs a stable identity across renders (it
  // drives the sheet's ongoing transform/animation) — `useState`'s lazy
  // initializer gives us that once, without the ref-read-during-render
  // pattern the lint rule (correctly) flags as unsafe under the React
  // Compiler. The PanResponder itself does *not* need referential
  // stability: it is just a plain object of responder-system callback
  // props, cheap to recreate every render — same as any inline onPress
  // closure — and recreating it means its callbacks always see the latest
  // `dismissible`/`onClose` directly, with no ref indirection at all.
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) translateY.set(0);
  }, [translateY, visible]);

  const requestClose = useCallback(() => {
    if (!dismissible) return;
    onClose();
  }, [dismissible, onClose]);

  const dismissGesture = useMemo(() => Gesture.Pan()
    .enabled(dismissible)
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      if (event.translationY > DRAG_DISMISS_THRESHOLD || event.velocityY > DRAG_DISMISS_VELOCITY * 1000) {
        scheduleOnRN(requestClose);
        return;
      }
      translateY.set(withTiming(0, { duration: 180 }));
    }), [dismissible, requestClose, translateY]);
  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={requestClose}>
      <View style={[local.overlay, theme.isDark && local.overlayDark]}>
        <Pressable
          style={local.backdrop}
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={requestClose}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            local.sheet,
            wide && local.sheetWide,
            {
              backgroundColor: theme.colors.bg,
              borderColor: theme.colors.line,
              paddingBottom: Math.max(insets.bottom, 16),
            },
            animatedSheetStyle,
          ]}
        >
          <GestureDetector gesture={dismissGesture}>
          <View>
            <View style={[local.handle, { backgroundColor: theme.colors.muted }]} />
            <View style={[local.header, { borderBottomColor: theme.colors.line }]}>
              <View style={local.headerCopy}>
                <Text style={[local.title, { color: theme.colors.ink }]}>{title}</Text>
                {subtitle ? <Text style={[theme.styles.muted, local.subtitle]}>{subtitle}</Text> : null}
              </View>
              {dismissible ? (
                <Pressable
                  onPress={requestClose}
                  accessibilityRole="button"
                  accessibilityLabel={closeLabel}
                  hitSlop={10}
                  style={[local.closeButton, { backgroundColor: theme.colors.panel, borderColor: theme.colors.line }]}
                >
                  <SymbolView
                    name={{ ios: "xmark", android: "close", web: "close" }}
                    size={16}
                    tintColor={theme.colors.ink}
                    fallback={<View />}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const local = {
  overlay: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(21,26,44,0.48)",
  },
  overlayDark: { backgroundColor: "rgba(0,0,0,0.78)" },
  backdrop: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    maxHeight: "92%" as const,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderWidth: 1,
    borderBottomWidth: 0,
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  sheetWide: {
    alignSelf: "center" as const,
    width: "100%" as const,
    maxWidth: 520,
  },
  handle: { width: 42, height: 4, borderRadius: 2, opacity: 0.45, alignSelf: "center" as const, marginBottom: 10 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 12,
    borderBottomWidth: 1,
    paddingBottom: 12,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 20, fontWeight: "900" as const, lineHeight: 26 },
  subtitle: { lineHeight: 18, marginTop: 2 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
