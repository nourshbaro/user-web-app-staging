import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from "react-native";

type Props = { style?: StyleProp<ViewStyle>; children: ReactNode };

/**
 * Keeps a form's fields and its action bar above the software keyboard, so the
 * user always sees what they type and can act without closing the keyboard.
 *
 * iOS: React Native's KeyboardAvoidingView with padding. Android draws
 * edge-to-edge, so its window no longer resizes for the keyboard, and
 * KeyboardAvoidingView measures itself relative to its parent rather than the
 * screen — it under-pads by whatever sits above it (the status-bar inset).
 * Android therefore measures this view in the window when the keyboard shows
 * and pads its bottom by exactly the overlap. Web has no software keyboard
 * events, so it is a plain view.
 */
export function KeyboardAwareView({ style, children }: Props) {
  if (Platform.OS === "ios") {
    return <KeyboardAvoidingView style={style} behavior="padding">{children}</KeyboardAvoidingView>;
  }
  if (Platform.OS === "android") return <AndroidKeyboardAwareView style={style}>{children}</AndroidKeyboardAwareView>;
  return <View style={style}>{children}</View>;
}

function AndroidKeyboardAwareView({ style, children }: Props) {
  const ref = useRef<View>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      // Padding is inside the view, so its measured frame is unaffected by the
      // current inset: the overlap is the view's window bottom below the keyboard.
      ref.current?.measureInWindow((_x, y, _width, height) => {
        setInset(Math.max(0, y + height - keyboardTop));
      });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View ref={ref} style={[style, inset > 0 && { paddingBottom: inset }]}>
      {children}
    </View>
  );
}
