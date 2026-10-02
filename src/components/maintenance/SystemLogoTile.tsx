import { useTheme } from "@/components/ui";
import { Image, View } from "react-native";

/**
 * v3 system-state logo tile: the LFA crest on a white rounded tile with the
 * card shadow. White in both themes (the crest is drawn for white). Sizes
 * from v3: maintenance 84 / radius 24 / crest 54; update dialog 72 / 20 / 46.
 */
export function SystemLogoTile({ size, radius, crest, label }: { size: number; radius: number; crest: number; label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: "#FFFFFF",
        boxShadow: theme.colors.shadowCard,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
        source={require("../../../assets/images/lfa-logo.png")}
        style={{ width: crest, height: crest }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={label}
      />
    </View>
  );
}
