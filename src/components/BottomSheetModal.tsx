import { useReducedMotion } from "@/hooks/useReducedMotion";
import { SymbolView } from "expo-symbols";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";
import { typography } from "@/lib/designTokens";
import { fontStyleFor } from "@/lib/fontFamilies";

const DRAG_DISMISS_THRESHOLD = 120;
const DRAG_DISMISS_VELOCITY = 0.6;
// Small breathing room kept around a field brought into view on focus, so
// its own label (and any helper/error line above it) stays visible too,
// instead of the field landing flush against the scroll viewport's edge —
// matches the app's common small-gap spacing (see e.g. BottomSheetModal's
// own header `gap: 12`).
const FIELD_VISIBILITY_MARGIN = 12;

export type BottomSheetModalHandle = {
  /**
   * Scrolls the shell's owned ScrollView (only relevant when `scrollable`)
   * just enough to bring `fieldRef`'s node fully into view, with
   * `FIELD_VISIBILITY_MARGIN` of context preserved on the side it was
   * clipped from — does nothing if the field is already fully visible.
   * Pass a ref to the field's outer wrapper (label + input), not just the
   * input, so the label comes into view too — native "scroll focused input
   * into view" behavior (iOS's keyboard insets, Android's focus system)
   * only knows about the input's own rect and will happily clip the label.
   * Also remembered as the "active" field: if the viewport later resizes
   * (e.g. the keyboard finishes animating in) it's rechecked automatically.
   */
  scrollFieldIntoView: (fieldRef: RefObject<View | null>) => void;
};

/**
 * Shared dismissible bottom sheet used across the app (cart preview, payment
 * method picker, account deletion, change password, legal text, contact
 * info, etc.) so every modal gets the same structure and dismiss affordances
 * for free:
 *   1. swipe down (from the handle/header) to dismiss
 *   2. tap the backdrop to dismiss
 *   3. an X icon in the top-right (never a textual "Close" button)
 *
 * Pass `dismissible={false}` for the rare case where dismissing mid-action
 * would leave the app in an unsafe/corrupt state (e.g. a delete-account
 * request in flight) — this hides the X and disables the swipe/backdrop
 * gestures without losing the rest of the sheet's behavior.
 *
 * Body sizing: the sheet itself stays intrinsically sized (it hugs short
 * content, like Contact Us or Payment Method) but never grows past
 * `maxHeight: "92%"`. Pass `scrollable` for content that can be long (forms,
 * legal text, a cart) — the shell then owns a single internal ScrollView for
 * `children`, using `flexShrink` (not `flex`) so it can shrink to fit under
 * that cap and scroll, without forcing short content to stretch or
 * collapsing to zero (a plain `flex: 1` child of this intrinsically-sized,
 * maxHeight-only container has no stable height to resolve against and
 * collapses the body — do not reintroduce that). The ScrollView also tracks
 * whether its content actually overflows the viewport and disables
 * scrolling/bounce when it doesn't, so a short form that fits doesn't feel
 * like a permanently-tall, meaninglessly-draggable page.
 */
export const BottomSheetModal = forwardRef<BottomSheetModalHandle, {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  dismissible?: boolean;
  closeLabel?: string;
  wide?: boolean;
  /** The shell owns a single vertical ScrollView for `children` instead of consumers nesting their own. */
  scrollable?: boolean;
  /** Lets the sheet adapt to the keyboard (iOS: pads the whole overlay so the sheet rises above it; Android already resizes for the keyboard, see the Modal's native SOFT_INPUT_ADJUST_RESIZE). */
  keyboardAware?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Fires once the native modal has actually finished presenting (RN Modal's `onShow`) — the right time to focus an input, since the child can mount before presentation completes. */
  onPresented?: () => void;
  /** v3 title style: `display` = the large condensed uppercase title (e.g. Filters); default = the condensed option-sheet title. */
  titleVariant?: "display" | "standard";
  /** One text action in the header (v3 "Reset"). When set it replaces the X; swipe and backdrop still dismiss. */
  headerAction?: { label: string; onPress: () => void; accessibilityHint?: string };
  /** Sticky footer below the body (v3 apply bar), separated by a hairline. */
  footer?: React.ReactNode;
}>(function BottomSheetModal({
  visible,
  onClose,
  title,
  subtitle,
  children,
  dismissible = true,
  closeLabel = "Close",
  wide,
  scrollable = false,
  keyboardAware = false,
  contentContainerStyle,
  onPresented,
  titleVariant = "standard",
  headerAction,
  footer,
}, ref) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const { meta } = useI18n();
  const titleToken = titleVariant === "display" ? typography.displaySheet : typography.displaySheetOption;
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
  const scrollViewRef = useRef<ScrollView>(null);
  // The inner content view a ScrollView measures its children against.
  // `ScrollView.getInnerViewNode()` returns a numeric tag, not a native host
  // ref — passing that to `measureLayout` is what produced "ref.measureLayout
  // must be called with a ref to a native component." `innerViewRef` is the
  // supported way to get an actual ref to that node.
  const scrollContentRef = useRef<View>(null);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  // The field last asked to be made visible (via `scrollFieldIntoView`) —
  // rechecked whenever the viewport itself resizes (e.g. the keyboard
  // finishes animating in/out), and cleared whenever the sheet closes so a
  // reopened sheet doesn't act on a stale field from a previous session.
  const activeFieldRef = useRef<RefObject<View | null> | null>(null);
  const [canScroll, setCanScroll] = useState(false);

  useEffect(() => {
    if (visible) translateY.set(0);
    else activeFieldRef.current = null;
  }, [translateY, visible]);

  const requestClose = useCallback(() => {
    if (!dismissible) return;
    onClose();
  }, [dismissible, onClose]);

  const updateCanScroll = useCallback(() => {
    const next = contentHeightRef.current > viewportHeightRef.current + 1;
    setCanScroll((current) => (current === next ? current : next));
  }, []);

  const revealField = useCallback((fieldRef: RefObject<View | null>) => {
    const scrollView = scrollViewRef.current;
    const contentNode = scrollContentRef.current;
    const field = fieldRef.current;
    if (!scrollView || !contentNode || !field) return;
    field.measureLayout(
      contentNode,
      (_left, fieldTop, _width, fieldHeight) => {
        // The active field may have changed (or the sheet closed) while
        // this async measurement was in flight — ignore a stale result.
        if (activeFieldRef.current !== fieldRef) return;

        const viewportHeight = viewportHeightRef.current;
        const visibleTop = scrollOffsetRef.current;
        const visibleBottom = visibleTop + viewportHeight;
        const fieldBottom = fieldTop + fieldHeight;

        let target: number | null = null;
        if (fieldTop < visibleTop) {
          target = fieldTop - FIELD_VISIBILITY_MARGIN;
        } else if (fieldBottom > visibleBottom) {
          target = fieldBottom - viewportHeight + FIELD_VISIBILITY_MARGIN;
        }
        if (target == null) return; // already fully visible

        const maxScroll = Math.max(0, contentHeightRef.current - viewportHeight);
        const clamped = Math.max(0, Math.min(target, maxScroll));
        if (Math.abs(clamped - visibleTop) < 1) return; // already effectively there

        scrollView.scrollTo({ y: clamped, animated: true });
      },
      () => {},
    );
  }, []);

  useImperativeHandle(ref, () => ({
    scrollFieldIntoView: (fieldRef) => {
      activeFieldRef.current = fieldRef;
      revealField(fieldRef);
    },
  }), [revealField]);

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

  const body = scrollable ? (
    <ScrollView
      ref={scrollViewRef}
      style={local.scrollBody}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEnabled={canScroll}
      bounces={canScroll}
      alwaysBounceVertical={false}
      onScroll={(event) => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
      // RN's own .d.ts types this as `RefObject<View>` (non-nullable),
      // predating React 19's `useRef<T>(null)` returning `RefObject<T |
      // null>` — the object shapes are otherwise identical, and any ref is
      // genuinely null before mount regardless of what this declares.
      innerViewRef={scrollContentRef as RefObject<View>}
      onLayout={(event) => {
        viewportHeightRef.current = event.nativeEvent.layout.height;
        updateCanScroll();
        // The viewport just resized (typically the keyboard finishing its
        // show/hide animation) — the field that was last brought into view
        // may no longer be, so recheck it rather than leaving it clipped.
        if (activeFieldRef.current) revealField(activeFieldRef.current);
      }}
      onContentSizeChange={(_width, height) => {
        contentHeightRef.current = height;
        updateCanScroll();
      }}
    >
      {children}
    </ScrollView>
  ) : children;

  return (
    // Reduced motion: the sheet fades in place instead of sliding.
    <Modal visible={visible} transparent animationType={reducedMotion ? "fade" : "slide"} onRequestClose={requestClose} onShow={onPresented}>
      <KeyboardAvoidingView
        style={local.keyboardAvoider}
        // Android's Modal already forces SOFT_INPUT_ADJUST_RESIZE on its own
        // dialog window, so its content is already laid out above the
        // keyboard — adding "height"/"padding" behavior there would
        // double-compensate. iOS's Modal window never resizes for the
        // keyboard, so "padding" here (applied to the *whole* overlay, not
        // nested deep inside the sheet's content) is what pushes the sheet
        // up above it, shrinking its own `maxHeight: "92%"` accordingly.
        behavior={keyboardAware && Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={local.overlay}>
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
                paddingBottom: footer ? 0 : Math.max(insets.bottom, 16),
              },
              animatedSheetStyle,
            ]}
          >
            <GestureDetector gesture={dismissGesture}>
              <View>
                <View style={[local.handle, { backgroundColor: theme.colors.border }]} />
                <View style={local.header}>
                  <View style={local.headerCopy}>
                    <Text
                      accessibilityRole="header"
                      style={[
                        { fontSize: titleToken.fontSize, lineHeight: titleToken.lineHeight, color: theme.colors.ink },
                        fontStyleFor("display", titleToken.fontWeight, meta.script),
                        // Uppercase display titles are Latin-only (Arabic has no case).
                        titleVariant === "display" && meta.script === "latin" ? local.titleUpper : null,
                      ]}
                    >
                      {title}
                    </Text>
                    {subtitle ? <Text style={[theme.styles.muted, local.subtitle]}>{subtitle}</Text> : null}
                  </View>
                  {headerAction ? (
                    <Pressable
                      onPress={headerAction.onPress}
                      accessibilityRole="button"
                      accessibilityLabel={headerAction.label}
                      accessibilityHint={headerAction.accessibilityHint}
                      hitSlop={10}
                      style={local.headerAction}
                    >
                      <Text style={[local.headerActionText, fontStyleFor("text", "600", meta.script), { color: theme.colors.brandInk }]}>{headerAction.label}</Text>
                    </Pressable>
                  ) : dismissible ? (
                    <Pressable
                      onPress={requestClose}
                      accessibilityRole="button"
                      accessibilityLabel={closeLabel}
                      // v3's 32pt button with a 44pt touch target.
                      hitSlop={6}
                      style={[local.closeButton, { backgroundColor: theme.colors.bgAlt }]}
                    >
                      <SymbolView
                        name={{ ios: "xmark", android: "close", web: "close" }}
                        size={16}
                        tintColor={theme.colors.textMuted}
                        fallback={<View />}
                      />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </GestureDetector>
            {body}
            {footer ? (
              <View style={[local.footer, { borderTopColor: theme.colors.hairline, paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>{footer}</View>
            ) : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

const local = {
  keyboardAvoider: { flex: 1 },
  // v3 backdrop: rgba(0,0,0,.4) in both themes.
  overlay: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  backdrop: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    maxHeight: "92%" as const,
    // v3 sheet: 28pt top corners, no border, soft upward shadow.
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 8,
    boxShadow: "0px -10px 40px rgba(0,0,0,0.2)",
  },
  sheetWide: {
    alignSelf: "center" as const,
    width: "100%" as const,
    maxWidth: 520,
  },
  // flexShrink (not flex/flexGrow) lets this ScrollView give up space once
  // the sheet above it hits its maxHeight cap, without zeroing out its own
  // contribution to that intrinsic-height calculation the way `flex: 1`
  // (flexBasis: 0) would — which is what collapsed the body previously.
  scrollBody: { flexShrink: 1 },
  handle: { width: 36, height: 5, borderRadius: 3, alignSelf: "center" as const, marginBottom: 12 },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 12,
    paddingHorizontal: 4,
    paddingBottom: 12,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  titleUpper: { textTransform: "uppercase" as const },
  headerAction: { minHeight: 44, justifyContent: "center" as const },
  headerActionText: { fontSize: 15, lineHeight: 20 },
  footer: { marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
  subtitle: { lineHeight: 18, marginTop: 2 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
