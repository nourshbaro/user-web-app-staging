import { AppText } from "@/components/foundation";
import { useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, TextInput, View } from "react-native";

export const OTP_LENGTH = 6;

/**
 * v3 one-time code: six cells drawing one logical six-digit value.
 *
 * A single real `TextInput` lies over the cells (transparent text and caret),
 * so typing, paste and OS autofill (iOS `oneTimeCode`, Android SMS) all go
 * through one native field and one `onChangeText`. The cells are
 * presentation only and hidden from assistive technology; the input carries
 * the label and value. The owner sanitizes and holds the value.
 */
export function OtpCodeInput({
  label,
  value,
  onChangeText,
  editable = true,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(autoFocus);
  // The active cell: the next one to fill, or the last once complete.
  const active = Math.min(value.length, OTP_LENGTH - 1);
  const complete = value.length >= OTP_LENGTH;

  return (
    <View style={local.wrap}>
      <AppText variant="meta" tone="muted" style={local.label}>{label}</AppText>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        disabled={!editable}
        accessible={false}
        style={local.row}
      >
        {Array.from({ length: OTP_LENGTH }, (_, index) => {
          const isActive = focused && editable && index === active;
          return (
            <View
              key={index}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                local.cell,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: isActive ? theme.colors.actionPrimary : theme.colors.border,
                  borderWidth: isActive ? 2 : 1,
                  opacity: editable ? 1 : 0.6,
                },
              ]}
            >
              {value[index] ? (
                <AppText style={[local.digit, { color: theme.colors.textStrong }]}>{value[index]}</AppText>
              ) : isActive && !complete ? (
                <Caret color={theme.colors.actionPrimary} reducedMotion={reducedMotion} />
              ) : null}
            </View>
          );
        })}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={editable}
          autoFocus={autoFocus}
          maxLength={OTP_LENGTH}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
          autoCorrect={false}
          caretHidden
          contextMenuHidden={false}
          selectionColor="transparent"
          underlineColorAndroid="transparent"
          accessibilityLabel={label}
          aria-disabled={!editable}
          style={local.input}
        />
      </Pressable>
    </View>
  );
}

/** v3 `lfCaret`: a 2×26 brand bar blinking in 1 s steps; static under reduced motion. */
function Caret({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 0, delay: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 0, delay: 500, useNativeDriver: true }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [opacity, reducedMotion]);
  return <Animated.View style={[local.caret, { backgroundColor: color, opacity }]} />;
}

const local = {
  wrap: { gap: 6 },
  label: { paddingStart: 4, fontWeight: "500" as const },
  // v3: repeat(6, 1fr), gap 8; cells 60pt tall, radius 14, 1pt hairline ring (2pt brand when active).
  // A code reads left to right in every locale: the cells never mirror.
  row: { flexDirection: "row" as const, direction: "ltr" as const, gap: 8 },
  cell: { flex: 1, height: 60, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const },
  digit: { fontSize: 26, lineHeight: 32, fontWeight: "600" as const },
  caret: { width: 2, height: 26, borderRadius: 1 },
  // The real field covers the row: taps, long-press paste and autofill reach it.
  input: {
    position: "absolute" as const,
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    color: "transparent",
    backgroundColor: "transparent",
    fontSize: 1,
    // Never paints (transparent text alone still left a hairline of the 1pt
    // text on Android). Not 0: iOS hit-testing skips views below 0.01 alpha,
    // which would lose long-press paste.
    opacity: 0.02,
  },
};
