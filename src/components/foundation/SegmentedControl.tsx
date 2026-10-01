import { useTheme } from "@/components/ui";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useI18n } from "@/i18n/I18nProvider";
import { fontStyleFor } from "@/lib/fontFamilies";
import { useEffect, useState } from "react";
import { Animated, Pressable, Text, View, type LayoutChangeEvent } from "react-native";

type Option<K extends string> = { key: K; label: string };

/**
 * v3 segmented control (`--seg` track, sliding card thumb). Presentation only:
 * the owner holds the value. `role` picks the semantics — `tab` for views of
 * one screen (My Tickets filters), `radio` for a setting (Appearance). The
 * thumb follows the reading direction and does not animate under reduced
 * motion.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  role = "tab",
}: {
  options: readonly Option<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel: string;
  role?: "tab" | "radio";
}) {
  const theme = useTheme();
  const { meta, isRTL } = useI18n();
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.key === value));
  const [thumb] = useState(() => new Animated.Value(index));

  useEffect(() => {
    if (reducedMotion) {
      thumb.setValue(index);
      return;
    }
    Animated.spring(thumb, { toValue: index, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
  }, [index, reducedMotion, thumb]);

  const segment = width > 0 ? (width - 6) / options.length : 0;

  return (
    <View
      accessibilityRole={role === "tab" ? "tablist" : "radiogroup"}
      accessibilityLabel={accessibilityLabel}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={[local.track, { backgroundColor: theme.colors.segment }]}
    >
      {segment > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            local.thumb,
            {
              width: segment,
              backgroundColor: theme.colors.surface,
              transform: [{ translateX: thumb.interpolate({ inputRange: [0, 1], outputRange: [0, isRTL ? -segment : segment] }) }],
            },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              if (!selected) onChange(option.key);
            }}
            accessibilityRole={role}
            accessibilityLabel={option.label}
            accessibilityState={role === "tab" ? { selected } : { checked: selected }}
            {...(role === "tab" ? { "aria-selected": selected } : { "aria-checked": selected })}
            style={local.segment}
          >
            <Text
              numberOfLines={1}
              style={[
                local.label,
                fontStyleFor("text", selected ? "600" : "500", meta.script),
                { color: selected ? theme.colors.textStrong : theme.colors.textMuted },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const local = {
  // v3: padding 3, radius 12; segments 32–34pt (the press target is the full 44pt row).
  track: { flexDirection: "row" as const, padding: 3, borderRadius: 12, minHeight: 44 },
  thumb: {
    position: "absolute" as const,
    top: 3,
    bottom: 3,
    start: 3,
    borderRadius: 9,
    boxShadow: "0px 1px 4px rgba(0,0,0,0.12)",
  },
  segment: { flex: 1, minHeight: 38, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: 4 },
  label: { fontSize: 14, lineHeight: 18 },
};
