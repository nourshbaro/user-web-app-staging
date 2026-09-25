import { useI18n } from "@/i18n/I18nProvider";
import { directionalChevron, PHYSICAL_LAYOUT_STYLE } from "@/i18n/direction";
import { SymbolView } from "expo-symbols";
import type { PropsWithChildren } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";

/**
 * Container for real-world geometry that must never mirror in RTL:
 * stadium maps, seat maps/grids, QR codes.
 */
export function PhysicalLayout({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[PHYSICAL_LAYOUT_STYLE, style]}>{children}</View>;
}

/** Decorative chevron that points "forward"/"back" relative to the reading direction. */
export function DirectionalChevron({
  kind = "forward",
  size = 20,
  color,
}: {
  kind?: "forward" | "back";
  size?: number;
  color: string;
}) {
  const { isRTL } = useI18n();
  const pointsRight = (kind === "forward") !== isRTL;
  return (
    <SymbolView
      accessible={false}
      name={directionalChevron(kind, isRTL) as never}
      size={size}
      tintColor={color}
      fallback={
        <Text accessible={false} style={{ color, fontSize: size }}>
          {pointsRight ? "›" : "‹"}
        </Text>
      }
    />
  );
}
